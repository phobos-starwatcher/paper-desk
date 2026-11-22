[CmdletBinding()]
param(
    [switch]$SkipTranslator,
    [switch]$InstallPlugin,
    [switch]$SkipReaderDependencies
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$nodePath = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$pythonPath = (Get-Command python.exe -CommandType Application | Select-Object -First 1).Source
$market = Join-Path $root 'marketplace'
$plugin = Join-Path $market 'plugins/paper-desk'
if (-not $SkipReaderDependencies) {
    & $pythonPath -m pip install --disable-pip-version-check --no-deps --target (Join-Path $root '.runtime') 'PyMuPDF==1.26.7'
    if ($LASTEXITCODE) { throw '无法安装 PyMuPDF。' }
}

if (-not $SkipTranslator) {
    $venv = Join-Path $root '.venv'
    $venvPython = Join-Path $venv 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        & $pythonPath -m venv $venv
        if ($LASTEXITCODE) { throw '无法创建翻译引擎的虚拟环境。' }
    }
    # BabelDOC 0.6.2 uses BitStream, which bitstring 5 no longer exports.
    & $venvPython -m pip install --disable-pip-version-check 'pdf2zh-next==2.9.0' 'babeldoc==0.6.2' 'bitstring==4.3.1'
    if ($LASTEXITCODE) { throw '无法安装本地 PDF 排版组件 pdf2zh-next。' }
    & (Join-Path $venv 'Scripts/pdf2zh_next.exe') --version
    if ($LASTEXITCODE) { throw '翻译引擎启动验证失败。' }
}

$spec = @{
    mcpServers = @{
        paper_desk = @{
            command = $nodePath
            args = @((Join-Path $plugin 'server.mjs'))
            env = @{ PAPER_DESK_ROOT = $root; PAPER_DESK_PYTHON = $pythonPath }
            startup_timeout_sec = 15
            tool_timeout_sec = 120
        }
    }
}
[System.IO.File]::WriteAllText((Join-Path $plugin '.mcp.json'), ($spec | ConvertTo-Json -Depth 6))

if ($InstallPlugin) {
    & codex plugin marketplace add $market --json
    if ($LASTEXITCODE) { throw 'Codex 未能注册本地插件市场。' }
    & codex plugin add paper-desk@paper-desk-local --json
    if ($LASTEXITCODE) { throw 'Codex 未能安装文献对读插件。' }
    Write-Host '重启 Codex 后，在侧栏中打开「文献对读」，或在对话里用「用文献对读打开这个 PDF」。'
}
