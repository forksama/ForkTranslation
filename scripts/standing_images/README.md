# Standing Images Scripts

这组脚本处理 `怪文书素材/1.立绘` 下的角色立绘。默认根目录已经写在脚本里：

```text
C:\Repositories\ForkTranslation\怪文书素材\1.立绘
```

如果以后要在临时目录试跑，给脚本传 `--root "C:\...\立绘tmp"` 即可。

## 脚本顺序

1. `trim_alpha_edges.py`

裁掉 `半身像` 和 `七分像` 中 PNG 外圈全透明边，保留图片内部透明通道。默认 dry-run，只有加 `--execute` 才覆盖。

```powershell
python scripts/standing_images/trim_alpha_edges.py
python scripts/standing_images/trim_alpha_edges.py --execute
```

2. `generate_half_body_2.py`

读取某个角色 `半身像-2` 中的同名示例图，用“示例高度 / 七分像高度”推导保留高度比例，把该角色全部 `七分像` 裁成审核用 `半身像-2`。生成后会再做一次 alpha 透明边裁剪。

```powershell
python scripts/standing_images/generate_half_body_2.py --character-dir "1-咲季立绘.1"
python scripts/standing_images/generate_half_body_2.py --character-dir "1-咲季立绘.1" --execute
```

如果 `半身像-2` 中已有多个同名示例，显式指定：

```powershell
python scripts/standing_images/generate_half_body_2.py --character-dir "1-咲季立绘.1" --example 开心.png --execute
```

3. `promote_half_body_2.py`

人工审核 `半身像-2` 后，将图片复制到 `半身像`。目标已存在同名文件时跳过，不覆盖；处理后删除对应的 `半身像-2` 源文件。

```powershell
python scripts/standing_images/promote_half_body_2.py
python scripts/standing_images/promote_half_body_2.py --execute
```

## 安全约定

- 三个脚本默认都是 dry-run。
- 需要改文件时必须显式加 `--execute`。
- `trim_alpha_edges.py` 会覆盖原图；重要批量处理可加 `--backup-dir`。
- `generate_half_body_2.py` 写入 `半身像-2`；已有同名输出会被重写，重要示例可加 `--backup-dir`。
- `promote_half_body_2.py` 不覆盖 `半身像` 中已有同名文件；源 `半身像-2` 文件处理后会删除，可加 `--backup-dir` 保留删除前副本。

完整流程见 [docs/立绘处理流程.md](../../docs/立绘处理流程.md)。
