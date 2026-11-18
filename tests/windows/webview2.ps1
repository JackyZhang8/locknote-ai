$ErrorActionPreference = 'Stop'
function Get-WebView2Version {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            try {
                $key = $base.OpenSubKey('SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
                if ($key) { try { $version = [string]$key.GetValue('pv'); if ($version -and $version -ne '0.0.0.0') { return $version } } finally { $key.Dispose() } }
            } finally { $base.Dispose() }
        }
    }
    throw 'WebView2 missing. Install Microsoft Evergreen Standalone Installer x64, then retry: https://developer.microsoft.com/microsoft-edge/webview2/'
}
