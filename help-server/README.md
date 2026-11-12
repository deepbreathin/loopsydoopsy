# Help server (optional)

The app's **Help & suggestions** box works without this: questions are answered from a built-in guide, and suggestions open a pre-filled GitHub issue. Set this up when you want **AI answers** and suggestions that **don't need a GitHub account**.

It's a free **Cloudflare Worker**. The free plan allows 100,000 requests a day and there's no card on file, so Cloudflare can't charge you. The only cost is the Claude API, and you control that:

- Buy a small amount of **prepaid credit** at [platform.claude.com](https://platform.claude.com) (Settings → Billing) and leave **auto-reload off**. It then cannot spend more than you put in.
- The Worker caps answers at **200 a day for everyone** and **15 per person** (`DAILY_LIMIT`, `PER_PERSON_DAILY_LIMIT` in `wrangler.toml`), and keeps answers short.
- Rough cost with the default model (Claude Opus 5.5): a cent or two per question. Set `MODEL = "claude-haiku-5-5"` for far less.

## Set up (about 15 minutes)

1. Make a free account at [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. In this folder:
   ```sh
   npm install
   npx wrangler login
   npx wrangler kv namespace create HELP_KV     # paste the id it prints into wrangler.toml
   npx wrangler secret put ANTHROPIC_API_KEY    # an API key from platform.claude.com
   npx wrangler secret put ADMIN_KEY            # make up a long password
   npx wrangler deploy                          # prints https://loopsydoopsy-help.<you>.workers.dev
   ```
3. Put that address in `www/js/config.js` as `HELP_SERVER`, commit and push. The web app picks it up on its next update.

## Reading suggestions

Open `https://loopsydoopsy-help.<you>.workers.dev/feedback?key=<your ADMIN_KEY>` in a browser. You'll see everything people sent, newest first, with the device they were on.

## Changing what the helper knows

The helper's knowledge of the app is `src/guide.js`. Update it when you add or change features, then run `npx wrangler deploy` again.
