# Connecting a LINE Official Account

Written for the person who owns the garage, not for a developer. It takes about 20 minutes, costs nothing to start, and you only do it once per shop.

You need: a LINE account on your phone, and a computer.

> **The one technical constraint, up front.** LINE's servers have to be able to reach this app over the internet — to deliver messages people send you, and to fetch the photos you attach to an update. `localhost` on your laptop is not reachable from the internet, so **do the steps below against the deployed app** (the Vercel staging URL), not a local dev server. Local development uses a stand-in that never talks to LINE at all — see [README](../README.md#line-in-dev).

---

## Part 1 — Create the Official Account (about 5 minutes)

An "Official Account" (OA) is the business account customers add as a friend. It is yours, not the platform's: your brand, your friends list, your message fees ([ADR-002](adr/ADR-002-per-shop-line-oa.md)).

1. Go to **[LINE Official Account Manager](https://manager.line.biz/)** and sign in — you can use the LINE account already on your phone.
2. Choose **Create an account** (สร้างบัญชี) and fill in:
   - **Account name** — what customers will see. Use the shop's real name; it is hard to change later and it is what appears at the top of every message.
   - **Category** — Car & Motorcycle / Car repair (ยานยนต์ → ซ่อมรถ) or the nearest match.
   - Country/region: **Thailand**.
3. Finish. You now have a free-plan OA. Its **Basic ID** looks like `@abc1234` — that is what customers search for.
4. Set the profile picture and a short description while you are here. Customers see them before they decide to add you.

**Cost:** the free plan includes a limited number of *push* messages per month. Replying inside a chat is free; the updates this app sends are pushes. The current allowance is shown in OA Manager under the plan section — a pilot shop sending a few updates per car will not come close at first, and paid tiers exist when you outgrow it.

---

## Part 2 — Turn on the Messaging API (about 5 minutes)

This is what lets the app send on the account's behalf.

1. In **OA Manager**, open **Settings** (ตั้งค่า) → **Messaging API**.
2. Click **Enable Messaging API** (ใช้ Messaging API).
3. It asks for a **Provider**. A provider is just the company/owner name that groups your channels — create one with your business name. Choose it, confirm.
4. When it finishes, it shows a **Channel ID** and a **Channel secret**. Leave this page open, or come back to it — you will copy the secret in Part 4.

Then, still in OA Manager:

5. Open **Settings → Response settings** (การตอบกลับ).
   - Turn **Auto-response messages OFF**. Otherwise every customer message gets an automatic canned reply, which looks odd next to the real updates your staff write.
   - Turn **Chat ON**, so replies land in your OA inbox where staff can answer them. This app never reads those replies — that is deliberate ([ADR-005](adr/ADR-005-line-identity-via-webhook.md)).
   - Turn **Webhooks ON**. This is the switch that lets the app learn who has added you.
   - A greeting message when someone first adds you is optional and fine to keep — it is your words, not the app's.

---

## Part 3 — Get the access token (about 3 minutes)

1. Go to the **[LINE Developers Console](https://developers.line.biz/console/)** and sign in with the same account.
2. Open your **provider** → the **Messaging API channel** that Part 2 created (it has your OA's name).
3. On the **Basic settings** tab, find **Channel secret** and copy it. Keep it somewhere safe for a minute.
4. On the **Messaging API** tab, scroll to **Channel access token (long-lived)** and click **Issue**. Copy the long string it produces.

You now have the two values the app asks for:

| What | Where it came from | What it does |
|---|---|---|
| **Channel secret** | Basic settings tab | Proves that messages arriving from LINE are genuinely from LINE |
| **Channel access token** | Messaging API tab | Lets the app send messages as your account |

Treat both like passwords. The app encrypts them before storing them ([ADR-004](adr/ADR-004-line-credential-encryption.md)) and never shows them again — if you lose them you can re-issue a token here at any time.

> LINE occasionally rearranges these consoles and renames tabs. If a label does not match, look for the *concept* — "channel secret", "channel access token", "webhook URL" — rather than the exact wording.

---

## Part 4 — Connect it to the app (about 3 minutes)

1. Open the app and sign in as a **Manager** (advisors can see the connection but not change it).
2. Go to **Settings**.
3. Paste the **Channel secret** and the **Channel access token**, then press **Verify and connect**.
   - The app calls LINE to check the credentials before saving anything. If they are wrong you get a plain message saying so, and nothing is stored.
   - On success the page shows your OA's real name and Basic ID — a good sanity check that you connected the account you meant to.
4. The page now shows a **Webhook URL for this shop**. Press **Copy**.
5. Back in the **LINE Developers Console → Messaging API tab → Webhook settings**:
   - Paste the URL into **Webhook URL** and **Update**.
   - Press **Verify**. It should report success.
   - Turn **Use webhook ON**.

That is the whole connection.

---

## Part 5 — Prove it works end to end (about 5 minutes)

1. On your phone, open LINE, search for your **Basic ID** (`@abc1234`) and **add the account as a friend**.
2. In the app, go back to **Settings**. Within a few seconds your own LINE profile appears under **LINE contacts**, unmatched.
   - Nothing appeared? The webhook is the usual culprit: re-check "Use webhook" is ON and the URL is exactly what the app showed. Sending a chat message to the account also triggers it.
3. Press **Match to customer**, type the phone number of a customer record (use your own test customer), press **Find**, then **Match**.
4. Open any repair case for that customer. In the **Customer timeline** panel you will find a Thai draft already written from the case's actual jobs.
5. Edit the wording however you like, tick one or two photos, press **Preview** to see exactly what will be sent, then **Send** — and press it a second time to confirm.
6. Your phone buzzes. The message and photos arrive in your own LINE.

If you got that message, the milestone's goal is met: *a customer's LINE receives a real update*.

---

## Things worth knowing before you hand this to staff

- **Nothing is ever sent automatically.** Not when a car is ready, not when a job finishes. Every message is written and sent by a person ([ADR-003](adr/ADR-003-no-auto-customer-notifications.md)). If updates stop going out, that is a staffing habit, not a system failure — and the planned fix is a reminder on the dashboard, not automatic messages.
- **Customers must add your account first.** There is no way around this — LINE gives no way to message someone who has not added you. A QR code poster at the counter is the practical answer; OA Manager can print one.
- **Replies do not come into this app.** They arrive in the LINE OA inbox (the OA Manager app on a phone works well for this). Staff answer there.
- **Photos you send stay reachable by their link.** Each photo you attach gets its own unguessable web address so LINE can fetch it, and it keeps working so the customer can scroll back through their history months later. Only photos someone deliberately attached and sent are reachable this way.
- **Each shop connects its own account.** Nothing is shared between shops — separate brands, separate friend lists, separate bills.

## If something goes wrong

| What you see | What it usually means |
|---|---|
| "LINE rejected these credentials" | The access token was copied incompletely, or it was re-issued in the console (issuing a new one invalidates the old). Issue a fresh one and reconnect. |
| Contacts never appear | "Use webhook" is off, or the Webhook URL does not match the one on the Settings page. Press **Verify** in the LINE console — it tells you what it got. |
| "That customer has not added the shop's LINE account" | They removed or blocked the account. They must add it again. |
| "This LINE account has reached its message limit" | The free plan's monthly push allowance is used up. Check the plan section in OA Manager. |
| Photos arrive broken | The app is not reachable from the internet at the address it is using — the usual cause is testing against a local dev server instead of the deployed one. |
