# Connecting a LINE Official Account

Written for the person who owns the garage, not for a developer. It takes about 20 minutes, costs nothing to start, and you only do it once per shop.

You need: a LINE account on your phone, and a computer.

> **The one technical constraint, up front.** LINE's servers have to be able to reach this app over the internet — to deliver messages people send you, and to fetch the photos you attach to an update. `localhost` on your laptop is not reachable from the internet, so **do the steps below against the deployed app** — currently <https://automotive-oa.vercel.app> — not a local dev server. Local development uses a stand-in that never talks to LINE at all — see [README](../README.md#line-in-dev).

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
   - Leave **Webhooks** alone for now. It is the switch that lets the app learn who has added you, but LINE will not let you turn it on until a webhook URL exists — you get that URL in Part 4, and turn the switch on there.
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

Treat both like passwords: type or paste them **only** into the app's Settings page and the LINE console. Never put them in a chat, an email, a ticket, or a commit — anyone holding them can message your whole friends list as you. If one does get exposed, re-issue it in this console (Basic settings → Channel secret → **Issue**; Messaging API tab → **Issue** a new access token), then reconnect in Settings. The old value stops working the moment you re-issue.

The app encrypts both before storing them ([ADR-004](adr/ADR-004-line-credential-encryption.md)) and never shows them again.

> LINE occasionally rearranges these consoles and renames tabs. If a label does not match, look for the *concept* — "channel secret", "channel access token", "webhook URL" — rather than the exact wording.

---

## Part 4 — Connect it to the app (about 3 minutes)

1. Open the deployed app (<https://automotive-oa.vercel.app>) and sign in as a **Manager** (advisors can see the connection but not change it).
2. Go to **Settings**.
3. Paste the **Channel secret** and the **Channel access token**, then press **Verify and connect**.
   - The app calls LINE to check the credentials before saving anything. If they are wrong you get a plain message saying so, and nothing is stored.
   - On success the page shows your OA's real name and Basic ID — a good sanity check that you connected the account you meant to.
4. The page now shows a **Webhook URL for this shop**. Press **Copy**. It looks like `https://automotive-oa.vercel.app/api/line/webhook/<a long shop id>` — the id is generated per shop and differs between the deployed app and a developer's laptop, so always copy it from the page rather than typing it out.
   - This URL is on the page from the start, even before you connect. Do not hand it to LINE any earlier than this, though: the endpoint checks every incoming request against the channel secret you stored in step 3, so until that exists it refuses everything and LINE's **Verify** button reports failure. That refusal is the endpoint working, not a fault.
5. Back in the **LINE Developers Console → Messaging API tab → Webhook settings**:
   - Paste the URL into **Webhook URL** and **Update**.
   - Press **Verify**. It should report success.
   - Turn **Use webhook ON**.

That is the whole connection.

---

## Part 5 — Prove it works end to end (about 10 minutes)

The app now sends the customer's updates itself ([ADR-007](adr/ADR-007-system-sent-customer-updates.md)): nobody at the desk writes them. So the proof is a visit walked in the app while your own phone plays the customer.

1. On your phone, open LINE, search for your **Basic ID** (`@abc1234`) and **add the account as a friend**.
2. In the app, go back to **Settings**. Within a few seconds your own LINE profile appears under **LINE contacts**, unmatched.
   - Nothing appeared? The webhook is the usual culprit: re-check "Use webhook" is ON and the URL is exactly what the app showed. Sending a chat message to the account also triggers it.
   - It says **(no display name)**? That is fine, and nothing to fix before continuing. The app only asks LINE for a name and picture when someone newly adds the account — and creating an OA usually makes you a friend of it already, so your "add" fires nothing and the contact arrives from a chat message instead. The LINE user ID beside it is the part that matters; once you match the contact to a customer, the app shows the customer's name everywhere anyway.
3. Press **Match to customer**, type the phone number of a customer record (use your own test customer), press **Find**, then **Match**. If that customer already has an open case, your phone buzzes right away with a **catch-up** — where the car stands now. That message is also how a wrong match shows itself: the person receives news about a car that is not theirs.
4. **Check in** that customer's car. Your phone receives *we have your car, we will inspect it and send a quotation* — with whatever you typed in the check-in's "Note to the customer" box as its last line.
5. Add a job or two, set prices, press **Send quotation**. The quotation arrives with a link to the numbered document.
6. Record the response as authorized, then work the jobs: **Start work** (*work has started*), **Waiting… → Parts** with an expected date on the part line (*waiting for parts, expected …*), **Start work** again (*parts arrived, work continued*), a job through **Send to QC → QC pass** while another is still in progress (*job finished*, with that job's photos), the last job to QC (*final quality check*), and its pass (*ready to collect*, with the amount you owe — and the finished work's photos).
7. Press **Mark delivered**, type a note, confirm. The thank-you arrives with your note as its last line and no money in it.
8. Fail a QC, cancel a job, change a price along the way: your phone stays silent for each of those. Those stay inside the shop.

If your phone told the story without anyone at the desk writing a word, the milestone's goal is met. On the case page, the **Customer updates** section is the same story as a compact log — each line says sent, not sent (and why), or failed — and **Send a message** opens the one dialog left for writing by hand.

---

## Part 6 — Let customers register from LINE (about 15 minutes, optional)

Since M7.8 a customer can tell you they have arrived from their own phone: they fill in a short form (name, phone, plate, what is wrong) and it appears on your **Check-in** page, ready to pull into the check-in. The form itself needs nothing from LINE. Enable it in **Settings → Customer check-in form**, print the QR it gives you, and put the QR on the counter. That is the plain door, and it works on its own.

This part opens the second door: the **same form inside LINE**. When a customer opens it from your Official Account, LINE tells the app who they are, so a returning customer just taps their car and describes the problem, and when your advisor confirms the arrival the customer's LINE is matched to their record automatically. No more matching by hand in the contacts inbox for those customers.

You need two more things from the LINE Developers Console: a **LINE Login channel** and a **LIFF app** inside it.

1. In the app, go to **Settings**, make sure the check-in form is **enabled**, and find the **Let customers register from LINE** panel. Leave it open: it shows the address you will paste in step 4.
2. In the **[LINE Developers Console](https://developers.line.biz/console/)**, open your provider and press **Create a new channel** → **LINE Login**.
   - **Create it under the SAME provider as your Official Account.** This is the one thing that cannot be fixed later: LINE gives a person the same id only within one provider. A Login channel under a different provider would report ids that never match the ones your OA already knows, and the automatic matching would silently never happen.
   - Region Thailand, any name customers may see (the shop's name is fine), app type **Web app**.
3. On the new channel's **LIFF** tab, press **Add**:
   - **LIFF app name**: ลงทะเบียน (or anything short).
   - **Size**: Full.
   - **Endpoint URL**: the **LIFF endpoint URL** shown in the app's Settings panel. Copy it from there; it is your check-in form's address.
   - **Scopes**: tick **profile** and **openid**. Both are needed: the second is what lets the app confirm the identity with LINE rather than trusting the phone.
   - Leave the rest as is and press **Add**. LINE shows a **LIFF ID** like `1234567890-AbCdEfGh`.
4. Back in the app's Settings panel, paste the **LIFF ID** into its field, and the Login channel's **Channel ID** (Basic settings tab of the Login channel, a plain number) into the second field. Press **Save**. The panel's badge reads **LINE door open**.
5. Test it: on your phone, open the LIFF URL (`https://liff.line.me/<your LIFF ID>`) inside LINE. The form should greet you by your LINE name. Submit an arrival; it appears on the Check-in page with a LINE mark.

Neither of these two values is a secret. Both are visible to every customer who opens the form, and neither can send a message as your account, so the app stores them as they are.

---

## Part 7 — The counter (about 10 minutes)

What actually sits on the counter, so that LINE is the default door and the plain QR is the fallback:

1. **Print the OA's add-friend QR** from OA Manager (**Home → Gain friends → QR code**) and put it on the poster. A customer who scans it adds your account and lands in the chat.
2. **Add a rich menu button named ลงทะเบียน** in OA Manager (**Home → Rich menus → Create**). Make one of its areas a **Link** whose URL is your LIFF URL, `https://liff.line.me/<your LIFF ID>`. Set it to display by default. Rich menus are configured here by hand; the app does not build them.
3. **Print the plain form QR** too, from **Settings → Customer check-in form → Print QR poster**, for customers who do not use LINE or do not want to add the account. It is the same form without the recognition.

If you later press **Rotate link** in Settings, the plain QR stops working immediately and needs reprinting, and the LIFF app's endpoint URL must be updated to the new address in the Developers Console. Rotate it if a poster walks out of the shop.

---

## Things worth knowing before you hand this to staff

- **From M7.10, the app sends most updates itself** ([ADR-007](adr/ADR-007-system-sent-customer-updates.md)). Your customers receive, without anyone pressing anything: a message when their car is checked in, the quotation when you send it, "work has started", "waiting for parts (expected …)" and "parts arrived", a photo message each time a job is finished, "final quality check", "ready to collect" with the amount, and a thank-you at handover. They never receive anything about a failed quality check, a cancelled job, or a price change — those stay inside the shop. Staff can still write a message by hand on the case page (**Send a message**). A customer with no LINE contact yet is not an error: every message they would have received is recorded as **not sent** on the case page, and matching them in Settings later sends one catch-up rather than the backlog.
- **Expect more pushes per car.** A typical visit sends around ten messages instead of two or three. Watch the free plan's monthly allowance in OA Manager during the first month.
- **Customers must add your account first.** There is no way around this — LINE gives no way to message someone who has not added you. A QR code poster at the counter is the practical answer; OA Manager can print one.
- **Replies do not come into this app.** They arrive in the LINE OA inbox (the OA Manager app on a phone works well for this). Staff answer there.
- **Photos you send stay reachable by their link.** Each photo you attach gets its own unguessable web address so LINE can fetch it, and it keeps working so the customer can scroll back through their history months later. Only photos someone deliberately attached and sent are reachable this way.
- **Each shop connects its own account.** Nothing is shared between shops — separate brands, separate friend lists, separate bills.

## If something goes wrong

| What you see | What it usually means |
|---|---|
| "LINE rejected these credentials" | The access token was copied incompletely, or it was re-issued in the console (issuing a new one invalidates the old). Issue a fresh one and reconnect. |
| LINE's **Verify** button fails | Usually the webhook URL was saved before the account was connected in the app's Settings. Connect first, then Verify. |
| Contacts never appear | "Use webhook" is off, or the Webhook URL does not match the one on the Settings page. Press **Verify** in the LINE console — it tells you what it got. |
| "That customer has not added the shop's LINE account" | They removed or blocked the account. They must add it again. |
| "This LINE account has reached its message limit" | The free plan's monthly push allowance is used up. Check the plan section in OA Manager. |
| Photos arrive broken | The app is not reachable from the internet at the address it is using — the usual cause is testing against a local dev server instead of the deployed one. |
| The form opens inside LINE but never recognizes anyone | The Login channel is under a different provider than the OA (Part 6, step 2). Create it again under the OA's provider. |
| "We could not confirm your LINE account" on the form | The Login channel ID in Settings does not match the channel the LIFF app belongs to, or the token expired. Check the two fields, then reopen the form from LINE. |
