fn main() {
    println!("cargo:rerun-if-changed=src/native-command-names.txt");
    let commands = include_str!("src/native-command-names.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let commands: &'static [&'static str] = Box::leak(commands);

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to build Tauri application metadata");
}
