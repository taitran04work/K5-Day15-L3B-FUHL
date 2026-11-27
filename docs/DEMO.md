# Stayra: five-minute demo

**Before you start**
- Run `docker compose up --build` and wait for `Seed complete` in the API log.
- Open three tabs:
  - **Admin**: http://localhost:5173/admin (`admin@stayra.dev` / `Admin@123`)
  - **Owner**: http://localhost:5173/app (`owner@pinehill.dev` / `Owner@123`)
  - **Guest**: http://localhost:5173/h/pine-hill
- Have `seed/rooms-import-sample.xlsx` and `seed/pine-hill-house-rules.pdf` ready.
- Without `ANTHROPIC_API_KEY`, the guided offline assistant answers. With a key, Claude answers. The script works either way.

## 1. Create a homestay (30 s), admin tab

1. Click **New homestay**. Name it "Lake House Đà Lạt", add an owner name and email, language Tiếng Việt, then **Create homestay**.
2. The drawer shows the invitation link and a temporary password; the link is also in the API log.
3. Point out the list: rooms, 30-day bookings, revenue, chats and AI tokens per homestay. **Suspend** takes a homestay offline instantly.

## 2. Import rooms and add photos (60 s), owner tab

1. Open the invite link in a private window, set a password and sign in as the new owner. You can also do this part with Pine Hill.
2. Go to **Rooms → Import**. Download the template if you want to show it, then choose `seed/rooms-import-sample.xlsx`.
3. The preview checks every row. Rows with problems are flagged and skipped. Click **Import 8 rooms**.
4. Open a room and go to the **Photos** tab. Drop in a few photos; they are resized to WebP in the browser.
5. Drag a photo to reorder it, **Set as cover**, and add a caption.
6. Mention **Pricing**: the weekend +20% rule and the Tết override, with the 60-day price preview on the right.

## 3. Upload the policy PDF, review and activate (60 s), owner tab

1. Go to **Policies → Upload PDF** and choose `seed/pine-hill-house-rules.pdf`.
2. The document goes from *Reading…* to *ready* live, and a banner appears: **New cancellation rules ready for review**.
3. Click **Review**:
   - On the left are the extracted rules: more than 7 days → 100% of the deposit, 3–7 days → 50%, under 72 hours → no refund. Each rule shows its source quote; click a quote to jump the PDF on the right to that page.
   - Change "72" to "48" and show the live warning that 48–72 hours isn't covered. Change it back.
4. Click **Activate rules** to publish version 2; the previous version moves to *Earlier versions*.
5. Approve one of the suggested quick answers at the bottom of the page.

## 4. Guest books through chat and pays the deposit (75 s), guest tab

The hackathon slice runs through the first part of step 4, when the guest receives the hold code and deposit card. The rest of the section shows the optional payment and inbox demo. See the [canvas](../canvas.md).

1. Open the round chat button. Tap **Show me the rooms**: room cards appear.
2. Type: *"I'd like a room for 2 people from <a Friday 2+ weeks away> for 2 nights"*. The assistant checks availability and quotes exact prices, with weekend pricing applied.
3. Choose an available room and enter demo contact details. Reply **“Skip”** if prompted for an optional email. Check the room, dates, guest count, total and deposit in the summary, then reply **“Confirm”**.
4. A booking summary card and a payment card ("Pay deposit …") appear. Click **Pay with MoMo** to open the real sandbox page, or **Simulate payment** in the card.
5. The card turns to *Paid*, and a system message confirms booking `STR-XXXXXX`.
6. In the **Owner → Inbox** tab the same conversation updated live, with tool calls shown as small "Checked availability" rows. Click **Take over**, reply as the host, then **Hand back to assistant**.
7. **Vietnamese and Zalo:** open http://localhost:5173/dev/zalo-simulator and type *"Chào bạn, cuối tuần này còn phòng không? 2 người"*. The assistant replies in Vietnamese through the same webhook pipeline, and the conversation shows in the owner inbox marked "Zalo".

## 5. Change room or cancel, refund quote, owner approval (45 s)

1. On the guest site go to **Manage booking**, enter the booking code and phone, then **Change dates or room**. Pick another room and **Check new price** to see the price difference explained. Confirm (auto-approved by default).
2. Click **Cancel booking**. The refund is quoted from the active rules, for example "21 days before check-in falls under 'More than 7 days before': 100% of the deposit".
3. To show owner approval: in **Owner → Assistant**, turn off *Approve cancellations automatically* and save. Now the guest's cancellation becomes a request.
4. In **Owner → Bookings**, the booking shows *Needs your decision*. Open it, adjust the refund amount if you like, then **Approve**. The MoMo refund is issued and the guest is notified in chat.
5. Sea Breeze House has no active policy, so its cancellations always wait for the owner.

## 6. Remaining balance sent automatically (30 s)

1. When the deposit is paid, a background job is scheduled per **Assistant → Payments** ("24 hours before check-in" by default).
2. To show it now: in **Owner → Bookings**, open the confirmed booking and click **Send payment link**. The same job code runs: a *Remaining balance* MoMo card appears in the guest's chat or Zalo conversation, and an unpaid link triggers a reminder later.
3. Optional: open http://localhost:8080/hangfire to show the scheduled `SendRemainingPayment` job.
4. Back on the **Overview**, the stat "Assistant handled N conversations, ~X h saved" has updated.
