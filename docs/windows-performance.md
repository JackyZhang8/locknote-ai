# 启动性能测量

## 本次实测

环境：macOS amd64，Intel i7-9750H @ 2.60GHz；本地合成数据、每档单次测量，与其他测试构建有并发。以下不是 Windows、冷缓存或前后对照成绩。

| 笔记数 | 改造后 Open ms | 显式完整检查 ms |
| --- | ---: | ---: |
| 100 | 17.73 | 32.88 |
| 1,000 | 13.05 | 271.4 |
| 10,000 | 14.00 | 2,720 |
| 30,000 | 49.44 | 25,222 |

完整检查含 SQLite integrity_check、foreign_key_check 和 FTS integrity-check，不能将整列耗时归因给 FTS。Open 含正常迁移检查；没有以跳过必要迁移获得数据。结果支持将重型检查从每次启动移到明确维护流程，但不能据此给出 Windows 提速倍数。

## 复现后端规模测试

~~~sh
go test ./internal/store -run '^$' -bench BenchmarkStartupScale -benchtime=1x -count=1
~~~

benchmark 使用临时数据库，准备阶段批量写入合成行并显式重建索引；测量阶段走正常 Open 及完整检查，验证笔记数量。它不测量 CreateNote 吞吐。不要对真实资料库运行压力写入。

## 前端构建

当前生产主 JS 337.56 KB（gzip 111.52 KB）；历史模块 13.99 KB（gzip 5.72 KB），插件设置 26.07 KB（gzip 9.66 KB）独立加载。主 CSS 53.60 KB；历史 CSS 5.48 KB 独立。Mermaid vendor 仍离线按需加载，无新增运行时依赖。

这些是资源体积，不代表 WebView 内存或首次可交互时间。此前中间构建的主 JS 362.64 KB 已包含部分拆分，不能当作完整改造前基线。

## Windows 补测方案

tests/windows/performance.ps1 对可丢弃合成数据重复启动，保存系统、CPU、内存、磁盘、数据库大小、startup.log 和外部启动耗时。它会写合成测试笔记，先确认 SYNTHETIC。分别准备 100/1k/10k/30k 及启用插件的数据集，记录笔记数/插件数。比较首次启动与后续启动的中位数、P95；冷启动必须通过重启等明确控制缓存，脚本自身不保证冷缓存。

使用相同硬件、WebView2、数据库与插件集合比较旧新构建；旧版没有埋点时补采等价外部可交互指标。当前 Windows 启动、峰值内存和磁盘 I/O：PARTIAL，未采集。
