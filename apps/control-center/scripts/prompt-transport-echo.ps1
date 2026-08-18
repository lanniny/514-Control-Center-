param([Parameter(Mandatory = $true, Position = 0)][string]$Prompt)
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$bytes = $utf8.GetBytes($Prompt)
$sha = [System.Security.Cryptography.SHA256]::Create()
$digest = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
$payload = @{
  echo = $Prompt
  digest = $digest
  byteLength = $bytes.Length
  codePointCount = $Prompt.Length
} | ConvertTo-Json -Compress
[Console]::Out.Write($payload)
[Console]::Out.Write("`n")
