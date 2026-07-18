# Scripts

仓库级辅助脚本说明。

## balance_wav_directory.py

批量平衡一个目录下的 WAV 语音片段响度。脚本适合短对白、台词、语音包一类素材；它使用有效 RMS 近似响度，不依赖 ffmpeg，也不是严格 LUFS 测量。

默认行为：

```text
audio/*.wav           归一化后的同名文件
audio/original/*.wav  未归一化的源文件
```

也就是说，运行后原来的音频路径保持不变，Premiere、映射文件或其他流程继续引用 `audio/*.wav` 即可；未处理前的源文件会被归档到 `original` 子目录。

常用命令：

```powershell
# 先预览每个文件会调整多少，不写文件
python scripts\balance_wav_directory.py "C:\path\to\audio" --dry-run

# 默认模式：归一化文件留在原目录，源文件移入 original
python scripts\balance_wav_directory.py "C:\path\to\audio"

# 指定目标响度，而不是使用目录中位数
python scripts\balance_wav_directory.py "C:\path\to\audio" --target-dbfs -18

# 指定源文件归档目录名
python scripts\balance_wav_directory.py "C:\path\to\audio" --archive-dir original-raw

# 只输出归一化副本，不移动源文件
python scripts\balance_wav_directory.py "C:\path\to\audio" --out-dir balanced
```

注意事项：

- 支持 16-bit 和 32-bit PCM WAV。
- 默认目标响度是当前目录内所有非静音文件的中位数。
- 会限制正向增益，避免削波；因此个别峰值很高的文件可能不会完全到达目标响度。
- 如果默认模式下 `original` 中已经存在同名文件，脚本会拒绝覆盖。需要重新试验时，换一个 `--archive-dir`，或先手动整理旧归档。
- 使用 `--recursive` 时，脚本会跳过归档目录和 `--out-dir` 目录，避免反复处理已生成文件。
