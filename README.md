# GeKongDianXue（隔空点穴灭蜡烛）

一个基于 MediaPipe Hands 的网页交互小项目：通过双手动作识别来触发蜡烛熄灭效果。  
当前采用“两阶段判定”来降低误触发：

1. 阶段 A：先识别到双手手花轨迹（动作主体）
2. 阶段 B：再识别到终点动作（右手半圈朝前指）
3. 仅当 A+B 都满足时才允许熄灭

## 当前状态（2026-04-06）

- 线上真人回归（最近一轮）：
- 完整动作成功率约 `7/10`
- 单手误触发约 `1/5`
- 仍有少量“手花阶段提前触发/漏检”边缘情况，后续可继续微调阈值

## 目录结构

- `index.html`：主页面（识别 + 蜡烛效果）
- `app.js`：实时识别主逻辑（包含两阶段门控）
- `shared.js`：轨迹处理、DTW、速度分析与阈值配置
- `record.html` + `record.js`：录制标准动作样本
- `load_data.html`：加载录制 JSON 并写入浏览器本地标准
- `tests/`：离线评估、特征提取、标注检查脚本

## 快速启动（网页）

在项目根目录执行：

```powershell
python -m http.server 8000
```

浏览器打开：

- `http://localhost:8000/index.html`（主识别页面）
- `http://localhost:8000/record.html`（录制标准动作）
- `http://localhost:8000/load_data.html`（导入录制数据）

## 识别逻辑要点

核心在 `app.js` 的状态机与门控变量：

- `phaseAReady`：阶段 A 是否满足
- `phaseBEntered` / `endpointSeenInAction`：阶段 B 是否进入并看到终点
- `finalMatched = endpointSeenInAction && baseMatched`

要点是“终点动作不是单独触发器”，而是动作序列最后一步的确认信号。

## 离线评估与数据复用

你之前录制的视频可以反复复用，做离线回归，不必每次真人重测。

### 1) 先准备/更新分段与标签

参考 `tests/videos/README.md`：

```powershell
& "D:\conda_env\content_assistant\python.exe" .\tests\video_splitter.py --input .\tests\videos\raw\session_01.mp4 --segment-seconds 5
```

然后在对应 `labels*.csv` 里标注 `label=1/0`。

### 2) 提取阶段信息 + 评估

一键脚本（推荐）：

```powershell
.\tests\run_two_stage_offline.ps1
```

或仅跑评估：

```powershell
node .\tests\eval_two_stage_from_labels.js
```

## 环境依赖

### 前端运行

- 通过 CDN 加载 MediaPipe（无需本地安装 npm 包）
- 需要摄像头权限

### Python 脚本（离线评估）

安装 `requirements.txt`：

```powershell
& "D:\conda_env\content_assistant\python.exe" -m pip install -r .\requirements.txt
```

另外，`video_splitter.py` 依赖系统已安装 `ffmpeg`（命令行可用）。

## 录制建议（影响识别稳定性）

- 录制速度尽量接近真实使用速度，不要刻意慢动作
- 动作路径尽量完整（先手花，再终点）
- 保持手部尽量在画面中、光线稳定、背景干扰少
- 同一批样本尽量保持镜头距离一致

## 下一步建议

- 固化一套“最小回归集”（正样本 + 普通负样本 + 难负样本）
- 每次改阈值后都跑一次 `run_two_stage_offline.ps1`
- 若继续追求稳定性，可考虑把终点动作拆成更显式的方向约束特征

