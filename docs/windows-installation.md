# Windows 安装与故障诊断

## 安装要求

Windows 10/11 x64，管理员权限，已安装 Microsoft Edge WebView2 Evergreen Runtime。EXE 和 MSI 均检测用户/机器、32/64 位注册表位置；缺失时明确停止，不无限等待在线下载。离线电脑请先从微软 WebView2 官方网站下载 Evergreen Standalone Installer x64，再安装应用。

发行资产为 locknote-ai-版本号-windows-x64.exe / .msi；安装后主程序为 locknote-ai.exe。新安装默认位于 Program Files/Locknote AI，数据仍在用户主目录 .locknote-mcp；安装器升级和卸载不得删除该数据目录。

## 安装诊断

在管理员 PowerShell 中执行（按实际路径替换）：

~~~powershell
msiexec.exe /i C:/Temp/locknote-ai-0.1.2-windows-x64.msi /qb! /L*V C:/Temp/locknote-msi.log
msiexec.exe /i C:/Temp/locknote-ai-0.1.2-windows-x64.msi /qn /norestart /L*V C:/Temp/locknote-msi-quiet.log
~~~

区分安装器未显示、安装失败回滚和安装完成但没有自动启动。检查进程退出码、LaunchCondition、权限、文件缺失及日志 Return value 3。当前缺少原 Windows 11 verbose log，不能认定原 MSI 无响应的唯一根因；已补上 WixUI_InstallDir、真实许可证与 WixUIExtension 链接。

## 自动验收

在干净的可丢弃 Windows VM、管理员 PowerShell 7、仓库根目录中运行：

~~~powershell
./tests/windows/acceptance.ps1 -PackageDir dist
./tests/windows/upgrade.ps1 -OldPackage C:/Temp/old.msi -NewPackage C:/Temp/new.msi -Kind msi
./tests/windows/performance.ps1 -Exe 'C:/Program Files/Locknote AI/locknote-ai.exe' -DataDir C:/Temp/synthetic-notes
~~~

upgrade 可指定 OldExe 和 OldInstallDir；仅同类型安装器升级，旧包必须是真正较低版本。测试使用独立临时数据目录，不访问真实笔记。upgrade 保留安装与测试数据供人工检查；旧版没有启动埋点时仅以 HTTP 判定旧程序服务可用，不声称旧版前端通过验收。

还需人工验证：双击 MSI 向导、普通用户运行、UAC、WebView2 缺失/断网、应用关闭、大库编辑搜索、旧版升级数据与混合安装器迁移。Windows Server CI 不能代替 Windows 11 实机。

## 数据库维护

先关闭 GUI、serve、stdio 及所有数据库写入者：

~~~powershell
& 'C:/Program Files/Locknote AI/locknote-ai.exe' check-db -data "$HOME/.locknote-mcp"
& 'C:/Program Files/Locknote AI/locknote-ai.exe' repair-indexes -data "$HOME/.locknote-mcp"
~~~

PowerShell 7 应等待进程完成并检查 LASTEXITCODE；GUI 子系统程序的终端输出可能不可见，可通过 Start-Process -Wait -PassThru 并重定向 stdout/stderr 获取结果。修复前生成 locknote.db.backup-时间戳，一致性备份包含已提交 WAL；不要在数据库打开时只复制主 DB。修复主要处理索引异常，不保证修复物理损坏数据库。备份失败不开始修复。
