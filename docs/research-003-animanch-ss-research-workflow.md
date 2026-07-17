# 调研档案 003：あにまん掲示板SS调查的可复用工作流程

- 档案编号：Research-003
- 建档日期：2026-07-12
- 状态：可复用流程
- 主题：特定角色中心SS与概念串的站内搜索、正文判定、篇幅统计及视频化验证

本文用于从あにまん掲示板提取特定角色中心的SS与概念串，并调查正文形式、安价／安科使用、篇幅和视频化状态。

## 1. 前提

### 正确的搜索入口

あにまん掲示板的搜索不使用主页查询参数，而是使用以下路径：

```text
现行串      https://bbs.animanch.com/search/关键词
过去串      https://bbs.animanch.com/search2/关键词
回复正文β   https://bbs.animanch.com/searchRes/关键词
```

不要使用以下错误形式：

```text
https://bbs.animanch.com/?q=关键词&flag=2
```

### 网络

Codex默认出口可能被Cloudflare返回403。本次环境通过使用与用户普通Chrome相同的本地HTTP代理恢复了搜索：

```text
http://127.0.0.1:7890
```

该地址依赖具体环境。下次应首先确认代理是否运行、端口是否改变。

Google资源请求中的`x-browser-channel`、`x-browser-validation`、`x-browser-year`及`x-client-data`等请求头不需要复制给あにまん。关键是使用能够正常访问的网络出口。

## 2. 连通性检查

使用PowerShell检查三个入口的HTTP状态：

```powershell
$urls = @(
  'https://bbs.animanch.com/search/%E8%B3%80%E9%99%BD%E7%87%90%E7%BE%BD',
  'https://bbs.animanch.com/search2/%E8%B3%80%E9%99%BD%E7%87%90%E7%BE%BD',
  'https://bbs.animanch.com/searchRes/%E8%B3%80%E9%99%BD%E7%87%90%E7%BE%BD'
)

foreach ($u in $urls) {
  curl.exe `
    --proxy http://127.0.0.1:7890 `
    -L --compressed `
    --connect-timeout 10 --max-time 30 `
    -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36' `
    -H 'Referer: https://bbs.animanch.com/' `
    -o NUL -sS `
    -w "STATUS=%{http_code} SIZE=%{size_download} URL=%{url_effective}`n" `
    $u
}
```

本次成功时三个入口均返回`200`。如果返回`403`，不要高频重复请求，应先检查代理。

## 3. 搜索词设计

### 基本词

不能只搜索正式角色名。以贺阳燐羽为例：

```text
賀陽燐羽
燐羽
りんは
燐羽様
りんちゃん
SyngUp
```

### 关系词和形式词

```text
燐羽「
賀陽燐羽「
学P「
SS
話書いていい
親愛度コミュ妄想
妹概念燐羽
幼馴染燐羽
担当燐羽
```

### 入口分工

- `search2`：通过标题建立过去串候选全集
- `search`：寻找当前仍在进行的新串
- `searchRes`：从正文发现标题没有角色名的串

`りんは`和`りんちゃん`会混入大量其他作品，必须结合游戏名、相关人物或分类再筛选。

## 4. 从搜索结果提取board编号、楼数和标题

搜索结果HTML含有如下结构：

```html
<a href='https://bbs.animanch.com/board/6898791/' ...>
  ...
  <p class='threadCount'>200</p>
  ...
  <span class='title ...'>スレタイトル</span>
</a>
```

PowerShell提取示例：

```powershell
$term = '賀陽燐羽'
$enc = [uri]::EscapeDataString($term)
$url = "https://bbs.animanch.com/search2/$enc"

$html = (
  curl.exe `
    --proxy http://127.0.0.1:7890 `
    -L --compressed -sS `
    -A 'Mozilla/5.0' `
    -H 'Referer: https://bbs.animanch.com/' `
    $url
) -join "`n"

$pattern = "<a href='https://bbs\.animanch\.com/board/(\d+)/' class='list-group-item row'>.*?<p class='threadCount'>(\d+)</p>.*?<span class='title[^']*'>(.*?)</span>"

$matches = [regex]::Matches(
  $html,
  $pattern,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

foreach ($m in $matches) {
  $id = $m.Groups[1].Value
  $count = $m.Groups[2].Value
  $title = [regex]::Replace($m.Groups[3].Value, '<[^>]+>', ' ')
  $title = [System.Net.WebUtility]::HtmlDecode($title).Trim()
  "$id`t$count`t$title"
}
```

### 优先级

1. 单串150楼以上
2. 连续多串合计150楼以上
3. 100楼以上
4. 楼数较少但正文很长的完结SS
5. 短篇、概念串

不能只按楼数判断质量。作者可能在一楼中刊载数千字，因此50至70楼的作品也可能超过2万字。

## 5. 获取各串正文

```powershell
$id = '6830978'
$url = "https://bbs.animanch.com/board/$id/"

$html = (
  curl.exe `
    --proxy http://127.0.0.1:7890 `
    -L --compressed -sS `
    -A 'Mozilla/5.0' `
    -H 'Referer: https://bbs.animanch.com/' `
    $url
) -join "`n"
```

正文位于以下结构：

```html
<li id='res1' ...>
  ...
  <div class='resbody good2'>正文</div>
</li>
```

提取正文：

```powershell
$bodies = [regex]::Matches(
  $html,
  "<div class='resbody[^']*'>(.*?)</div></li>",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

$plain = ''
foreach ($body in $bodies) {
  $text = $body.Groups[1].Value
  $text = [regex]::Replace($text, '<br\s*/?>', "`n", 'IgnoreCase')
  $text = [regex]::Replace($text, '<[^>]+>', ' ')
  $text = [System.Net.WebUtility]::HtmlDecode($text)
  $plain += $text + "`n"
}
```

## 6. 机械初筛

```powershell
$resCount = $bodies.Count
$charCount = $plain.Length
$quoteCount = ([regex]::Matches($plain, '「')).Count
$diceCount = ([regex]::Matches(
  $plain,
  'dice\d|安価|あんこ',
  'IgnoreCase'
)).Count
```

人物名＋台词的估算：

```powershell
$namedDialogue = ([regex]::Matches(
  $plain,
  '(?:燐羽|学P|プロデューサー|手毬|美鈴|継|咲季|ことね)(?:「|『)'
)).Count
```

### 数字解释

- `diceCount > 0`不能立即排除；它可能来自引用、前串链接或普通回复
- `namedDialogue`较多，说明可能是“人物名＋台词”体
- `quoteCount`较多而`namedDialogue`较少，说明可能是普通小说中的对话
- `charCount`可能包含图片或链接替代文本，只能视为概算

机械筛选后，必须人工阅读开头、中段和结尾。

## 7. 正文形式分类

### A：人物名＋台词为主

```text
学P「……」
燐羽「……」
```

这是核心目标，包括架空剧情和剧本式SS。

### B：普通小说，但以对话为主

```text
「遅かったわね、プロデューサー」
俺の担当アイドル、賀陽さんは既に待っていた。
```

虽然没有人物名标签，但故事主要由会话推动。

### C：日记、书信或第一人称记录

```text
○月☆日
話が違う。
引退ライブが有耶無耶にされてる。
```

它不是台词体，但如果人物中心度和篇幅都很高，应列为重要参考。

### D：普通小说、心理描写为主

主要由叙述组成。可保留为精品候选，但必须与台词体列表分开。

## 8. 安价、安科判断

### 排除对象

- 使用`dice1d100`等决定剧情、好感度或登场人物
- 根据`>>10`的内容推进故事
- 投票决定下一步剧情
- 用骰子决定初始设定，并将结果作为整个故事前提

### 注意事项

- 正文出现一次`dice`不能直接定性
- 前串介绍可能含骰子文字
- 普通读者随手掷骰、而作者没有采用，不一定属于安科作品
- 如果系列初代通过骰子决定主人公设定，即使续篇不再掷骰，也应与纯非安科作品分栏

## 9. 主角与女主角判断

按以下顺序判断：

1. 视点人物是否为燐羽
2. 主要情感变化和事件是否围绕燐羽发生
3. 在与P的恋爱或担当关系中，燐羽是否为唯一或主要对象
4. 即使标题没有角色名，正文中心是否为燐羽
5. 群像作品中，燐羽是否拥有独立的长篇章

如果燐羽只是作为SyngUp!成员出场，应放入参考栏。若手毬或原创人物才是核心，则不能计算为“燐羽单独女主”。

## 10. 系列识别

检查第1至2楼中的OGP链接，寻找：

- 前串
- 续篇
- 前作
- 过去串列表
- 同作者的另一视角作品

即使单串少于150楼，只要属于同一故事，就可以合计。但必须分别标明，例如：

```text
第一部82楼
第二部105楼
系列合计187楼
```

如果同题作品是掉线途中稿与重新发布的完成版，则不能相加。只把完成版视为正文，旧版标为途中稿。

## 11. 反向确认视频化

### 搜索顺序

1. 完整匹配串标题
2. 去掉符号后搜索
3. 加上`に対する反応`
4. 组合`学マス`、`賀陽燐羽`及故事关键词
5. 搜索board编号
6. 搜索YouTube以外的视频索引

### 检查位置

- YouTube
- Bilibili，包括日语视频的翻译转载
- Yutura
- ブィレーダー
- Digital Creators
- NicoNico／nicozon

### 注意改题

视频标题可能与原串不同。有些视频仅在原题后加`に対する反応`，另一些会改成对剧情事件的夸张描述。最可靠的证据是视频简介中`引用元`、`出典`后的board编号。

视频状态统一分为：

```text
已视频化
未发现视频化
视频化不明（搜索证据不足）
```

若判定为“已视频化”，必须把已发现的视频链接直接贴在对应作品旁边，例如：

```text
视频化：已发现（YouTube：https://www.youtube.com/watch?v=...）
```

同一作品有多个视频时逐条列出，不能只写“有”或“已发现”。如果只找到了视频标题但未能确认引用元或board编号，应暂记为“视频化不明”并保留搜索线索。

不能把“未发现”写成“绝对不存在”；删除、私人及限定公开视频无法通过搜索确认。

## 12. 精品判断

优先考虑：

- 已完结
- 作者连续刊载正文
- 正文字数较多
- 设定和人物关系一致
- 不是靠普通讨论回复堆高楼数
- 存在续篇
- 模仿官方剧情时具有明确话数结构
- 故事涉及燐羽的动机、姐姐継、SyngUp!或与P的关系

低优先级：

- 单纯一发梗
- 仅募集性癖或情景
- 实装、性能预测
- 图片、外貌讨论
- 燐羽只出现数楼的群像

## 13. Markdown记录字段

每部作品至少记录：

```text
作品名
board URL
楼数
系列合计
正文概算字数
燐羽的地位
正文形式
安价／安科使用
完结状态
视频化状态
简短概要
推荐度
注意事项
```

完结状态必须单独检查并说明依据。建议使用：

```text
已完结
连载中／有续篇
中断／旧途中稿
完结状态不明（需复核结尾）
```

判断时至少阅读开头、中段和结尾，并检查最后数楼、作者发言、前后串链接、标题中的“完成版／続き／その2”等信号。概念串或讨论串不能因为楼数到200就直接视为完结。

建议最终文档结构：

```text
1. 结论
2. 未视频化精品串
3. 单独提取人物台词体、非安价／非安科作品
4. 150楼以上但已视频化
5. 规模很大但不符合条件的参考系列
6. 推荐顺序
7. 统计
8. 调研限制
```

## 14. 本次确认的重要board

```text
4502599  賀陽燐羽の日記
4588899  賀陽燐羽の日記2
6830978  賀陽燐羽親愛度コミュ妄想SS・完成版
6804806  同SSの途中稿
5276402  あの賀陽燐羽さんですか？
6808884  賀陽燐羽と心中する話
6987801  賀陽継と賀陽燐羽
5234707  私の憧れた太陽
6197547  賀陽燐羽は距離が近い
6047102  似た者同士
6623405  ことねと燐羽とことね妹
6516580  妹概念賀陽燐羽
6532958  妹概念賀陽燐羽2
6898791  妹概念燐羽におばか♡
6180904  燐羽「徹夜明けの美鈴はヤバい」
6158732  通い妻幼馴染燐羽
6693593  P死亡ドッキリで泣く燐羽
6798649  男手毬SyngUp!シリーズPart36
5271467  ワイちゃんSyngUp!シリーズ初代
```

## 15. 失败案例与注意事项

### 失败1：误判搜索入口

不能根据主页表单外观猜测为`?q=&flag=`。必须使用正规路径。

### 失败2：只从外部视频反查

从YouTube出发，候选自然会严重偏向已视频化作品。必须先通过あにまん搜索建立母集，再与视频侧求差集。

### 失败3：只使用普通搜索引擎

普通搜索引擎很少收录あにまん过去串。`site:bbs.animanch.com`没有结果，不能说明作品不存在。

### 失败4：只看楼数

存在65楼、约2.5万字的完整10话SS；也存在200楼但几乎全是讨论的串。应同时检查楼数、正文字数和作者正文占比。

### 失败5：遗漏标题中没有人物名的作品

应使用`searchRes`和关系词。但回复正文β可能偏向现行或较新结果，未必等同于完整的过去正文检索。

## 16. 下次最短执行流程

1. 通过`127.0.0.1:7890`确认三个入口均返回200
2. 使用正式名、简称和关系词搜索`search2`
3. 建立board编号、楼数和标题表
4. 优先获取150楼以上候选正文
5. 对50至149楼中带SS或话数标记的作品也获取正文
6. 正文转成纯文本，统计字数、对话数量和dice关键词
7. 阅读开头、中段和结尾，确定形式和主角
8. 追踪前串、续篇链接并合计系列楼数
9. 阅读结尾和前后串说明，记录完结状态及依据
10. 通过标题、改题关键词和board编号反查视频化；已发现时把视频链接贴在作品旁边
11. 单独提取“人物台词为主、非安价／非安科”作品
12. 生成Markdown并保存至`outputs/`

按这个顺序，可以避免候选偏向已视频化作品，也更容易发现未视频化的长篇，以及楼数低但字数高的作品。
