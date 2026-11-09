param(
  [Parameter(Mandatory = $true)][string]$BinPath,
  [Parameter(Mandatory = $true)][ValidateSet('Add', 'Remove')][string]$Action
)
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
  $value = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $entries = @($value -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $BinPath.TrimEnd('\') })
  if ($Action -eq 'Add') { $entries += $BinPath }
  $kind = if ($null -eq $key.GetValue('Path')) { [Microsoft.Win32.RegistryValueKind]::ExpandString } else { $key.GetValueKind('Path') }
  $key.SetValue('Path', ($entries -join ';'), $kind)
} finally {
  $key.Close()
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArkEnvironmentBroadcast {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
$result = [UIntPtr]::Zero
[void][ArkEnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
