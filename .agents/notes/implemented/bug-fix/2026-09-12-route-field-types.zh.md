# Agent Note: mutating routes require the declared wire type

Status: implemented

## Problem

每个写路由都通过一个调用 `String()` 的助手读取其字符串字段。请求体是任意 JSON，因此 `{"url": {"href": "x"}}` 抵达时是字符串 `"[object Object]"`——非空，于是随后的 `url === ''` 检查通过，`POST /sources/add` 注册了一个 url 就是这段字面文本的来源。`{"branch": {}}`、`{"name": {}}`、`{"text": {}}` 行为相同：条目可以以字面量 `[object Object]` 为名被创建、替换或删除，内容也是这段文本。形状正确的请求体从不受影响，因此市场页面也无从暴露这次强转。

## Decision

路由声明为字符串的字段必须以字符串抵达。`textField(value, label)` 对其他任何类型抛出 `` `${label} must be a string` ``，并且每个调用点保留自己的缺失/空值检查：字段缺省仍然是 `""`，仍然报 `missing …`，因此"缺省"和"类型错误"依然可区分。缺省本身有既定含义的字段保留该含义——省略 `branch` 仍然表示没有分支，省略 `refreshSource` 的 id 仍然表示全部来源——但类型错误的值现在会被拒绝，而不是悄悄走同一条路径。LSP enabled 路由同样要求 JSON 布尔值，而不是把除 `false` 以外的一切都当作真。

强转以 `describe()` 的形式保留，只用于把不可信值渲染进诊断消息——在那里，被强转的文本本身才是要点，而不是一个值。

## Consequences

畸形请求体现在会得到点名出错字段的 400，而不是把垃圾写进 profile。这正是该文件其余部分一贯的做法——`setEnabled`、`setSurface`、`setMcpOverride`、`mcpReauthorize`、`setMcpBackend` 都在做 `typeof` 检查——所以强转助手是异类，而非本决策是新增策略。

代价是依赖宽松解析的调用方会失败。`src/client/` 里没有任何地方为这些字段发送非字符串；它们全部是表单里输入的值。

## Alternatives considered

**保留强转，只收紧后续检查。** 强转之后做形状检查无法把 `"[object Object]"` 与合法 url 区分开，因此这会需要为 url、分支名、条目名各写一套取值语法。类型检查才是真正能成立的那个检查。

**任一字段类型不对就整体拒绝请求体。** 路由点名第一个出错字段，告诉调用方该改哪个字段；一律返回 400 做不到这一点。

**只对会落盘的字段要求声明类型。** 这与实际落地的做法接近，但那些看起来只读的字段（enabled 路由上的 `id`）同样以不可信输入驱动查找，把助手拆成两半会让规则比应用它更难陈述。

## Testing

`tests/routes.test.ts` 把每种错误类型形状发到对应路由，断言点名的 400 以及空的存储记录——没有任何 `addSource`、`updateSource`、`refreshSource`、`setLspServerEnabled` 或面板调用被触达。随后断言缺省仍然报 `missing source url`，以及同一字段以字符串形式仍能抵达存储。把 `textField` 的函数体换回 `return String(value)`，第一个用例就会变回 `ok: true`，这正是本记录所记载的失败；把 `refreshSource` 的回退逻辑还原，它的用例同样会变回 `ok: true`。
