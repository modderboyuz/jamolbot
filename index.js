const TelegramBot = require("node-telegram-bot-api")
const { createClient } = require("@supabase/supabase-js")

// Bot tokenini o'rnatish
const token = "8093195655:AAHENZs_P5NW7Hou6130e3A4EU8PJDBcNXo"
const bot = new TelegramBot(token, { polling: true })

// Supabase clientini yaratish
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "YOUR_SUPABASE_URL"
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY"
const supabase = createClient(supabaseUrl, supabaseKey)

// App URL
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://your-app.vercel.app"

// Foydalanuvchi sessiyalarini saqlash
const userSessions = new Map()

// Bot start komandasi
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const startPayload = match[1].trim()

  console.log(`Start komandasi: ${userId}, payload: ${startPayload}`)

  if (startPayload.startsWith("_web_login_")) {
    const parts = startPayload.split("_")
    if (parts.length >= 5) {
      const sessionToken = parts[3]
      const timestamp = parts[4]
      const clientId = parts[5] || "jamolstroy_web"

      await handleWebLogin(chatId, userId, msg.from, sessionToken, timestamp, clientId)
    } else {
      await handleWebLogin(chatId, userId, msg.from)
    }
  } else {
    await handleStart(chatId, userId, msg.from)
  }
})

// Start komandasi
async function handleStart(chatId, userId, user) {
  try {
    // Foydalanuvchi mavjudligini tekshirish
    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (existingUser) {
      await bot.sendMessage(
        chatId,
        `Salom ${existingUser.first_name}! 👋\n\n` +
          `JamolStroy ilovasiga xush kelibsiz!\n\n` +
          `Ilovani ochish uchun quyidagi tugmani bosing:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🏗️ Ilovani ochish", web_app: { url: appUrl } }]],
          },
        },
      )
    } else {
      await bot.sendMessage(
        chatId,
        `Assalomu alaykum! JamolStroy botiga xush kelibsiz! 🏗️\n\n` +
          `Ro'yxatdan o'tish uchun telefon raqamingizni yuboring:`,
        {
          reply_markup: {
            keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        },
      )
    }
  } catch (error) {
    console.error("Start komandasi xatoligi:", error)
    await bot.sendMessage(chatId, "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
  }
}

// Web login
async function handleWebLogin(
  chatId,
  userId,
  user,
  sessionToken = null,
  timestamp = null,
  clientId = "jamolstroy_web",
) {
  try {
    // Foydalanuvchi mavjudligini tekshirish
    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (!existingUser) {
      await bot.sendMessage(chatId, `Siz hali ro'yxatdan o'tmagansiz. Iltimos, avval ro'yxatdan o'ting:`, {
        reply_markup: {
          keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
      return
    }

    if (sessionToken) {
      // Session token orqali login
      await bot.sendMessage(
        chatId,
        `Salom ${existingUser.first_name}! 👋\n\n` +
          `JamolStroy websaytiga kirishga ruxsat berasizmi?\n\n` +
          `⚠️ Faqat ishonchli manbalardan kelgan so'rovlarga ruxsat bering.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Ruxsat berish", callback_data: `approve_login_${sessionToken}` },
                { text: "❌ Rad etish", callback_data: `reject_login_${sessionToken}` },
              ],
            ],
          },
        },
      )
    } else {
      // Oddiy web app ochish
      const tempToken = generateTempToken()

      await supabase
        .from("users")
        .update({
          temp_token: tempToken,
          temp_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", existingUser.id)

      await bot.sendMessage(
        chatId,
        `Salom ${existingUser.first_name}! 👋\n\n` + `JamolStroy ilovasiga kirish uchun quyidagi tugmani bosing:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🏗️ Ilovani ochish", web_app: { url: `${appUrl}?token=${tempToken}` } }]],
          },
        },
      )
    }
  } catch (error) {
    console.error("Web login xatoligi:", error)
    await bot.sendMessage(chatId, "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
  }
}

// Callback query handler
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id
  const userId = callbackQuery.from.id
  const data = callbackQuery.data

  if (data.startsWith("approve_login_")) {
    const sessionToken = data.replace("approve_login_", "")
    await handleLoginApproval(chatId, userId, sessionToken, true)
  } else if (data.startsWith("reject_login_")) {
    const sessionToken = data.replace("reject_login_", "")
    await handleLoginApproval(chatId, userId, sessionToken, false)
  }

  // Callback query ni javoblash
  await bot.answerCallbackQuery(callbackQuery.id)
})

// Login approval handler
async function handleLoginApproval(chatId, userId, sessionToken, approved) {
  try {
    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (!existingUser) {
      await bot.sendMessage(chatId, "Foydalanuvchi topilmadi.")
      return
    }

    // Session statusini yangilash
    const { error } = await supabase
      .from("login_sessions")
      .update({
        status: approved ? "approved" : "rejected",
        user_id: approved ? existingUser.id : null,
        approved_at: approved ? new Date().toISOString() : null,
      })
      .eq("session_token", sessionToken)
      .eq("telegram_id", userId)

    if (error) {
      console.error("Session update error:", error)
      await bot.sendMessage(chatId, "Xatolik yuz berdi.")
      return
    }

    if (approved) {
      await bot.editMessageText(`✅ Login tasdiqlandi!\n\n` + `Websaytda avtomatik tizimga kirasiz.`, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
      })
    } else {
      await bot.editMessageText(`❌ Login rad etildi.\n\n` + `Xavfsizlik uchun login so'rovi bekor qilindi.`, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
      })
    }
  } catch (error) {
    console.error("Login approval error:", error)
    await bot.sendMessage(chatId, "Xatolik yuz berdi.")
  }
}

// Telefon raqam qabul qilish
bot.on("contact", async (msg) => {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const contact = msg.contact

  if (contact.user_id !== userId) {
    await bot.sendMessage(chatId, "Iltimos, o'z telefon raqamingizni yuboring.")
    return
  }

  try {
    // Foydalanuvchi mavjudligini tekshirish
    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (existingUser) {
      await bot.sendMessage(chatId, "Siz allaqachon ro'yxatdan o'tgansiz! ✅")
      return
    }

    // Sessiyaga telefon raqamni saqlash
    userSessions.set(userId, {
      phoneNumber: contact.phone_number,
      step: "waiting_first_name",
    })

    await bot.sendMessage(chatId, "Telefon raqamingiz qabul qilindi! ✅\n\n" + "Endi ismingizni kiriting:", {
      reply_markup: { remove_keyboard: true },
    })
  } catch (error) {
    console.error("Contact qabul qilishda xatolik:", error)
    await bot.sendMessage(chatId, "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
  }
})

// Matn xabarlarini qabul qilish
bot.on("message", async (msg) => {
  if (msg.contact || msg.text?.startsWith("/")) return

  const chatId = msg.chat.id
  const userId = msg.from.id
  const text = msg.text

  const session = userSessions.get(userId)
  if (!session) return

  try {
    if (session.step === "waiting_first_name") {
      session.firstName = text
      session.step = "waiting_last_name"
      userSessions.set(userId, session)

      await bot.sendMessage(chatId, "Familiyangizni kiriting:")
    } else if (session.step === "waiting_last_name") {
      session.lastName = text

      // Foydalanuvchini ma'lumotlar bazasiga qo'shish
      const tempToken = generateTempToken()

      const { data, error } = await supabase
        .from("users")
        .insert({
          telegram_id: userId,
          phone_number: session.phoneNumber,
          first_name: session.firstName,
          last_name: session.lastName,
          is_verified: true,
          temp_token: tempToken,
          temp_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single()

      if (error) throw error

      // Supabase auth user yaratish
      const { error: authError } = await supabase.auth.admin.createUser({
        email: `${userId}@telegram.local`,
        password: `tg_${userId}_${session.phoneNumber}`,
        email_confirm: true,
      })

      if (authError) {
        console.error("Auth user creation error:", authError)
      }

      await bot.sendMessage(
        chatId,
        `Tabriklaymiz! Ro'yxatdan o'tish muvaffaqiyatli yakunlandi! 🎉\n\n` +
          `👤 ${session.firstName} ${session.lastName}\n` +
          `📱 ${session.phoneNumber}\n\n` +
          `Endi JamolStroy ilovasidan foydalanishingiz mumkin!`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🏗️ Ilovani ochish", web_app: { url: `${appUrl}?token=${tempToken}` } }]],
          },
        },
      )

      // Sessionni tozalash
      userSessions.delete(userId)
    }
  } catch (error) {
    console.error("Matn xabarini qayta ishlashda xatolik:", error)
    await bot.sendMessage(chatId, "Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
    userSessions.delete(userId)
  }
})

// Temp token yaratish
function generateTempToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Xatoliklarni qayta ishlash
bot.on("polling_error", (error) => {
  console.error("Polling xatoligi:", error)
})

console.log("JamolStroy Telegram bot ishga tushdi! 🚀")
console.log("Bot username: @jamolstroy_bot")
