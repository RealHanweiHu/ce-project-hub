# CE Hub DingTalk Interactive Card Template

Use this template for CE Hub action items: task approval, deliverable review,
issue validation, delay impact confirmation, and MP release confirmation.

## Template Name

CE Hub 行动项卡片

## Template Type

IM card / message card. Associate it with the CE Hub DingTalk internal app.

## Variables

Create all variables as string variables.

| Variable | Mock value | Purpose |
| --- | --- | --- |
| `title` | `交付物待审核：ID 外观图` | Card title |
| `body` | `项目 EVT-001 的交付物已提交，请审核。` | Main context |
| `status` | `pending` | Machine status: `pending` or `handled` |
| `statusText` | `待处理` | Visible status label |
| `handledText` | `已通过，相关行动项已闭环。` | Completion message after update |
| `primaryActionText` | `通过` | Primary button text |
| `primaryActionUrl` | `https://example.com/api/action-card/execute?token=primary` | Primary button link |
| `primaryActionToken` | `primary` | Reserved for callback-mode buttons |
| `secondaryActionText` | `驳回` | Secondary button text |
| `secondaryActionUrl` | `https://example.com/api/action-card/execute?token=secondary` | Secondary button link |
| `secondaryActionToken` | `secondary` | Reserved for callback-mode buttons |

## Layout

1. Header row
   - Left text: `CE Hub`
   - Right tag: `${statusText}`

2. Title
   - Text: `${title}`
   - Font weight: bold

3. Body
   - Text: `${body}`
   - Allow multi-line display

4. Handled message
   - Text: `${handledText}`
   - Show only when `status == handled`

5. Button row
   - Show only when `status == pending`
   - Primary button text: `${primaryActionText}`
   - Primary button click event: link jump to `${primaryActionUrl}`
   - Secondary button text: `${secondaryActionText}`
   - Secondary button click event: link jump to `${secondaryActionUrl}`

6. Optional detail link
   - Text/button: `打开详情`
   - Link: `${primaryActionUrl}`
   - Show when action buttons are hidden or after handled.

## Display Rules

Use these rules if the builder supports conditional visibility.

| Component | Show when |
| --- | --- |
| Pending button row | `status == pending` |
| Handled message | `status == handled` |
| Primary button | `primaryActionText` is not empty |
| Secondary button | `secondaryActionText` is not empty |

If the builder does not support checking empty strings, keep both buttons visible.
CE Hub sends empty button text only for action types that do not need a second
button, so the worst case is a blank secondary button during early testing.

## Recommended Styling

- Keep the card narrow and operational, not promotional.
- Use a neutral background.
- Use a small status tag in the header.
- Avoid large decorative images.
- Keep the main text under 3 lines when possible.
- Button order: primary action first, reject/reopen/snooze second.

## Publish And Configure

Save and publish the template in the DingTalk card builder first. A template
that is only imported or saved as a draft will make DingTalk return
`cardInstance.wrong` when CE Hub tries to send a native card.

After publishing the template, copy its template ID into production:

```env
DINGTALK_INTERACTIVE_CARD_TEMPLATE_ID=your_template_id
```

If DingTalk shows a robot code for the associated robot, also set:

```env
DINGTALK_INTERACTIVE_ROBOT_CODE=your_robot_code
```

Then restart CE Hub. If the template ID or robot code is missing, CE Hub will
fall back to DingTalk ActionCard work notifications.
