!macro updateArkPath action
  InitPluginsDir
  File /oname=$PLUGINSDIR\ark-path.ps1 "${PROJECT_DIR}\resources\installer\path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ark-path.ps1" -BinPath "$INSTDIR\bin" -Action ${action}'
  Pop $0
  Pop $1
  ${if} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Could not update the user PATH for the Ark command. $1"
  ${endif}
!macroend

!macro customInstall
  !insertmacro updateArkPath Add
!macroend

!macro customUnInstall
  !insertmacro updateArkPath Remove
!macroend
