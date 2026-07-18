// 514cc Console 桌面壳（Tauri 2）
// 架构（烛 R1 评审后重构）：单一 supervisor 线程独占内核 Child 全生命周期，
// 所有状态转换（URL 就绪/窗口建成/内核死亡/关闭请求/启动超时）经 mpsc 事件在
// supervisor 单线程内判定——消除检查-执行竞态；任何退出路径统一走 taskkill /T
// 杀整棵进程树 + wait() 回收，堵孤儿 node 与僵尸进程。UI 全部由内核 Web 面板提供。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::{AppHandle, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

const KERNEL_PORT: u16 = 51400;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
// 内核 stdout 握手行的固定前缀（apps/control-center/server.mjs 的启动横幅）。
const URL_PREFIX: &str = "514cc Control Center: ";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

enum Event {
    UrlFound(Url),
    StdoutEof,
    WindowBuilt(Result<(), String>),
    Shutdown,
}

fn repo_root() -> PathBuf {
    // 自用系统：默认写死 514cc 仓库根，可用 CC_ROOT 环境变量覆盖（如仓库迁移）。
    std::env::var("CC_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"I:\514claude\514cc"))
}

fn spawn_kernel() -> std::io::Result<Child> {
    let cc_dir = repo_root().join("apps").join("control-center");
    let mut cmd = Command::new("node");
    cmd.arg(cc_dir.join("server.mjs"))
        .current_dir(&cc_dir)
        .env("CONTROL_CENTER_PORT", KERNEL_PORT.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

/// 严格解析握手行：固定前缀 + http + 127.0.0.1 + 内核端口 + 非空 token 片段。
/// 尾随文本按空白截断，不把整行交给 URL 解析器。
fn parse_kernel_url(line: &str) -> Option<Url> {
    let rest = line.strip_prefix(URL_PREFIX)?;
    let raw = rest.split_whitespace().next()?;
    let url: Url = raw.parse().ok()?;
    let valid = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(KERNEL_PORT)
        && url
            .fragment()
            .is_some_and(|f| f.starts_with("token=") && f.len() > "token=".len());
    valid.then_some(url)
}

/// 有界回收：try_wait 轮询 + 硬截止。true = 已回收。
/// try_wait 出错时如实打印并按"未回收"返回（状态未知走安全方向，烛 R3）。
fn reap_within(child: &mut Child, budget: Duration) -> bool {
    let deadline = Instant::now() + budget;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Err(e) => {
                eprintln!("try_wait failed ({e}); kernel state unknown");
                return false;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

/// 统一清理：杀整棵进程树 + 全程有界（烛 R2/R3：任何一步都不无界阻塞）。
/// Windows 无 SIGTERM 等价物，taskkill /T /F 杀树（内核会 spawn 健康探测子进程，
/// 只杀直接 child 会留孤儿）。taskkill 以 fire-and-forget 方式 spawn——不等它退出，
/// 它自身卡死也不阻塞我们（极端下泄漏一个系统工具进程，交 OS，好过壳挂死）。
/// 5s 内核未死 → 回退 child.kill() 再给 2s → 仍未死如实放弃交 OS。
/// 内核 instance-lock 有 stale 回收（强杀后重启已实测可恢复），强杀不破坏下次启动。
fn kill_kernel_tree(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return; // 已死已回收
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn(); // 不 status()：等待 taskkill 本身就是无界阻塞点（烛 R3）
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    if !reap_within(child, Duration::from_secs(5)) {
        eprintln!("kernel tree not down after taskkill budget; falling back to direct kill");
        let _ = child.kill();
        if !reap_within(child, Duration::from_secs(2)) {
            // 如实语义（烛 R4）：Windows 不会自动杀孤儿进程——这里是"停止追踪并退出"，
            // 不是"OS 会收拾"。极端场景（taskkill 且 kill 全失败）内核可能残留，日志留痕。
            eprintln!("kernel still alive after all bounded attempts; giving up tracking");
        }
    }
}

/// supervisor：独占 Child，事件驱动。返回前保证内核树已清理（有界）。
/// exit_requested：主线程在 RunEvent::ExitRequested 时提早置位的共享退出意图——
/// 早于 Exit 阶段的 Shutdown 消息，堵"内核死亡与关窗竞速导致误记异常退出码"（烛 R3）。
fn supervisor(
    app: AppHandle,
    tx: Sender<Event>,
    rx: Receiver<Event>,
    exit_requested: Arc<AtomicBool>,
) {
    let mut child = match spawn_kernel() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("514cc kernel spawn failed: {e}. Check node on PATH and CC_ROOT.");
            app.exit(1);
            return;
        }
    };

    // stdout 读线程：抓到 URL 后继续读到 EOF——EOF 即内核死亡信号（运行期监督，
    // 不再需要轮询 try_wait）。读错误与 EOF 同路径，立即进入清理而非空等超时。
    match child.stdout.take() {
        Some(stdout) => {
            let tx_reader = tx.clone();
            std::thread::spawn(move || {
                let mut url_sent = false;
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if !url_sent {
                        if let Some(url) = parse_kernel_url(&line) {
                            url_sent = true;
                            if tx_reader.send(Event::UrlFound(url)).is_err() {
                                return;
                            }
                        }
                    }
                }
                let _ = tx_reader.send(Event::StdoutEof);
            });
        }
        None => {
            kill_kernel_tree(&mut child);
            app.exit(1);
            return;
        }
    }

    let mut deadline = Instant::now() + STARTUP_TIMEOUT;
    let mut window_up = false;
    let mut clean_shutdown = false;

    loop {
        let timeout = if window_up {
            Duration::from_secs(3600) // 运行期无 deadline，只等事件
        } else {
            deadline.saturating_duration_since(Instant::now())
        };
        match rx.recv_timeout(timeout) {
            Ok(Event::UrlFound(url)) => {
                // 给窗口构建留出独立预算，消除"URL 已到却被启动超时误杀"的边界
                deadline = Instant::now() + Duration::from_secs(15);
                let tx_win = tx.clone();
                let app_win = app.clone();
                let dispatched = app.run_on_main_thread(move || {
                    // Windows 上 Webview 窗口必须在主线程创建；结果回传 supervisor
                    let built = WebviewWindowBuilder::new(
                        &app_win,
                        "main",
                        WebviewUrl::External(url),
                    )
                    .title("514cc Console")
                    .inner_size(1440.0, 920.0)
                    .min_inner_size(960.0, 640.0)
                    .build()
                    .map(|_| ())
                    .map_err(|e| e.to_string());
                    let _ = tx_win.send(Event::WindowBuilt(built));
                });
                if dispatched.is_err() {
                    eprintln!("failed to dispatch window creation to main thread");
                    break;
                }
            }
            Ok(Event::WindowBuilt(Ok(()))) => {
                window_up = true;
            }
            Ok(Event::WindowBuilt(Err(e))) => {
                eprintln!("console window build failed: {e}");
                break;
            }
            Ok(Event::StdoutEof) => {
                // 关窗与内核死亡可能竞速到达（烛 R2/R3）：先查共享退出意图（ExitRequested
                // 阶段已置位，早于 Shutdown 消息入队），再 drain 通道兜已入队的 Shutdown
                if exit_requested.load(Ordering::SeqCst) {
                    clean_shutdown = true;
                }
                while let Ok(ev) = rx.try_recv() {
                    if matches!(ev, Event::Shutdown) {
                        clean_shutdown = true;
                    }
                }
                if !clean_shutdown {
                    eprintln!("514cc kernel exited unexpectedly (stdout EOF)");
                }
                break;
            }
            Ok(Event::Shutdown) => {
                clean_shutdown = true;
                break;
            }
            Err(RecvTimeoutError::Timeout) => {
                if !window_up {
                    eprintln!(
                        "514cc kernel did not become ready within the startup budget; giving up."
                    );
                    break;
                }
                // window_up 时的 Timeout 只是长轮询到期，继续等事件
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    kill_kernel_tree(&mut child);
    if !clean_shutdown {
        // 异常路径（启动失败/窗口失败/内核崩溃）：结束应用；正常关窗路径 app 已在退出中
        app.exit(1);
    }
}

fn main() {
    let (tx, rx) = mpsc::channel::<Event>();
    let rx_slot: Arc<Mutex<Option<Receiver<Event>>>> = Arc::new(Mutex::new(Some(rx)));
    let sup_handle: Arc<Mutex<Option<JoinHandle<()>>>> = Arc::new(Mutex::new(None));
    let exit_requested = Arc::new(AtomicBool::new(false));

    let tx_setup = tx.clone();
    let rx_for_setup = rx_slot.clone();
    let handle_for_setup = sup_handle.clone();
    let exit_flag_setup = exit_requested.clone();

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let rx = rx_for_setup
                .lock()
                .expect("rx slot lock poisoned at setup")
                .take()
                .expect("supervisor receiver already taken");
            let tx_sup = tx_setup.clone();
            let flag = exit_flag_setup.clone();
            let join = std::thread::spawn(move || supervisor(handle, tx_sup, rx, flag));
            *handle_for_setup
                .lock()
                .expect("supervisor handle lock poisoned at setup") = Some(join);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(move |_app, event| match event {
            RunEvent::ExitRequested { .. } => {
                // 最后一个窗口关闭即置位退出意图——早于 Exit 的 Shutdown 消息（烛 R3）
                exit_requested.store(true, Ordering::SeqCst);
                let _ = tx.send(Event::Shutdown);
            }
            RunEvent::Exit => {
                exit_requested.store(true, Ordering::SeqCst);
                let _ = tx.send(Event::Shutdown);
                // 独立作用域 take，避免持锁 join
                let join = sup_handle.lock().ok().and_then(|mut slot| slot.take());
                if let Some(join) = join {
                    let _ = join.join(); // supervisor 清理全程有界，join 不会无限挂
                }
            }
            _ => {}
        });
}
