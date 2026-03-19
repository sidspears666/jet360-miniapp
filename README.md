# Mini App (FuelCards)

## Files
- `index.html`
- `styles.css`
- `app.js`

## Before deploy
1. Open `app.js`.
2. Update `API_BASE` if needed:
```js
const API_BASE = "https://flow.gojet.com.tr/webhook";
```

## Endpoints expected by app
- `GET ${API_BASE}/courier/:telegramId/orders`
- `GET ${API_BASE}/courier/:telegramId/history`
- `GET ${API_BASE}/courier/:telegramId/balance`
- `POST ${API_BASE}/courier/register`
- `PATCH ${API_BASE}/order/:id/status`

## BotFather
Set Menu Button URL to:
- `https://<your-miniapp-domain>/index.html`

## Important
The app must be opened inside Telegram Mini App (it uses `Telegram.WebApp.initData`).
