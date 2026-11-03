# Agent Note：预设不会声称一个根本不注入的风格

Status: implemented

## Problem

预设管理器的输出风格面有两个错的事实。其一，套件带来的风格，归属标签写成了「用户」——标签用「子行」的判据决定归属，而风格从不携带 `suiteResourceId`。其二，摘要把「携带的风格」直接算作存在，不管它的文本有没有被抓取过，于是预设可能一边写着「风格 X」，一边那个风格什么都不注入。

## Decision

- **清单把未抓取的套件风格标出来**：`unavailableReason: 'style-uncaptured'`，由管理器映射成一句点名做法的话——到输出风格面抓取一次。未知代码会被原样打印，所以映射与该代码一起发布。
- **风格的归属取自它自己的 source**：`source === 'user'` 是人写的，其余来自套件。
- **摘要说明风格是否生效**：`presetCoverage` 报告 `styleInEffect`，不生效时那一行读作 风格 X（未抓取，暂不生效）。

## Alternatives considered

- **在预设管理器里隐藏未抓取的风格。** 否决：预设可以合法地携带它，隐藏会让预设内容无法阅读。
- **把这种风格算作「没有携带」。** 否决：预设确实带着它；读者需要知道的是它此刻不注入。

## Consequences

- 预设的内容与提示词实际收到的东西不再互相矛盾。
- 管理器里的风格行会点名那唯一能让它生效的动作。

## Verification

- 在 `market-dev` 实测：管理器的输出风格面读作 `explanatory-output-style · 套件 · 不可用 · 这个套件风格还没有抓取到文本…`，此前标签是「用户」。
- `preset-coverage.test.ts` 钉住已抓取与未抓取两种情形下的 `styleInEffect`。
- `client-extension-presets.test.ts` 用字典自身的值钉住归属标签。
- 全量测试通过（2523）。
