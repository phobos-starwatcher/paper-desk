param(
    [Parameter(Mandatory)][string]$SuggestedName,
    [string]$InitialDirectory
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = [System.Windows.Forms.SaveFileDialog]::new()
try {
    $dialog.Title = 'Paper Desk - Save translated PDF'
    $dialog.Filter = 'PDF (*.pdf)|*.pdf'
    $dialog.DefaultExt = 'pdf'
    $dialog.AddExtension = $true
    $dialog.OverwritePrompt = $true
    $dialog.RestoreDirectory = $true
    $dialog.FileName = $SuggestedName
    if ($InitialDirectory -and [System.IO.Directory]::Exists($InitialDirectory)) {
        $dialog.InitialDirectory = $InitialDirectory
    } else {
        $dialog.InitialDirectory = [Environment]::GetFolderPath('MyDocuments')
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        @{ path = $dialog.FileName } | ConvertTo-Json -Compress
    } else {
        @{ cancelled = $true } | ConvertTo-Json -Compress
    }
} finally {
    $dialog.Dispose()
}
