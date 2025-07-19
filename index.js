import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

const TELEGRAM_BOT_TOKEN = "8093195655:AAHENZs_P5NW7Hou6130e3A4EU8PJDBcNXo"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

// In-memory session storage (production da Redis ishlatish kerak)
const userSessions = new Map()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log("Webhook received:", JSON.stringify(body, null, 2))

    if (body.message) {
      await handleMessage(body.message)
    } else if (body.callback_query) {
      await handleCallbackQuery(body.callback_query)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

async function handleMessage(message: any) {
  const chatId = message.chat.id
  const userId = message.from.id
  const text = message.text

  console.log(`Message from ${userId}: ${text}`)

  if (text?.startsWith("/start")) {
    const startPayload = text.replace("/start", "").trim()
    console.log("Start payload:", startPayload)

    if (startPayload.startsWith("web_login_")) {
      const parts = startPayload.split("_")
      console.log("Login parts:", parts)

      if (parts.length >= 4) {
        const sessionToken = parts[2]
        const timestamp = parts[3]
        const clientId = parts[4] || "jamolstroy_web"

        console.log("Processing web login:", { sessionToken, timestamp, clientId })
        await handleWebLogin(chatId, userId, message.from, sessionToken, timestamp, clientId)
      } else {
        console.log("Invalid login payload format")
        await sendMessage(chatId, "Noto'g'ri login so'rovi. Iltimos, qaytadan urinib ko'ring.")
      }
    } else {
      await handleStart(chatId, userId, message.from)
    }
  } else if (message.contact) {
    await handleContact(chatId, userId, message.contact, message.from)
  } else if (text && !text.startsWith("/")) {
    await handleTextMessage(chatId, userId, text, message.from)
  }
}

async function handleCallbackQuery(callbackQuery: any) {
  const chatId = callbackQuery.message.chat.id
  const userId = callbackQuery.from.id
  const data = callbackQuery.data

  console.log(`Callback from ${userId}: ${data}`)

  if (data.startsWith("approve_login_")) {
    const sessionToken = data.replace("approve_login_", "")
    console.log("Approving login for session:", sessionToken)
    await handleLoginApproval(chatId, userId, callbackQuery.message.message_id, sessionToken, true)
  } else if (data.startsWith("reject_login_")) {
    const sessionToken = data.replace("reject_login_", "")
    console.log("Rejecting login for session:", sessionToken)
    await handleLoginApproval(chatId, userId, callbackQuery.message.message_id, sessionToken, false)
  }

  // Callback query ni javoblash
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: data.startsWith("approve_") ? "✅ Tasdiqlandi" : "❌ Rad etildi",
    }),
  })
}

async function handleStart(chatId: number, userId: number, user: any) {
  try {
    console.log("Handling start for user:", userId)

    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (existingUser) {
      console.log("Existing user found:", existingUser.first_name)

      const tempToken = generateTempToken()

      // Temp token yangilash
      await supabase
        .from("users")
        .update({
          temp_token: tempToken,
          temp_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", existingUser.id)

      await sendMessage(
        chatId,
        `🎉 Salom ${existingUser.first_name}!\n\n` +
          `JamolStroy ilovasiga xush kelibsiz!\n\n` +
          `📱 Ilovani ochish uchun quyidagi tugmani bosing:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🏗️ Ilovani ochish", web_app: { url: `${APP_URL}?token=${tempToken}` } }]],
          },
        },
      )
    } else {
      console.log("New user, requesting registration")

      await sendMessage(
        chatId,
        `👋 Assalomu alaykum!\n\n` +
          `🏗️ <b>JamolStroy</b> botiga xush kelibsiz!\n\n` +
          `📋 Ro'yxatdan o'tish uchun telefon raqamingizni yuboring:`,
        {
          reply_markup: {
            keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
          parse_mode: "HTML",
        },
      )
    }
  } catch (error) {
    console.error("Start handler error:", error)
    await sendMessage(chatId, "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
  }
}

async function handleWebLogin(
  chatId: number,
  userId: number,
  user: any,
  sessionToken: string,
  timestamp: string,
  clientId: string,
) {
  try {
    console.log("Handling web login for user:", userId, "session:", sessionToken)

    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (!existingUser) {
      await sendMessage(chatId, `❌ Siz hali ro'yxatdan o'tmagansiz.\n\n` + `📋 Iltimos, avval ro'yxatdan o'ting:`, {
        reply_markup: {
          keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      })
      return
    }

    // Session tokenni yangilash
    const { error: sessionError } = await supabase
      .from("login_sessions")
      .update({ telegram_id: userId })
      .eq("session_token", sessionToken)

    if (sessionError) {
      console.error("Session update error:", sessionError)
    }

    await sendMessage(
      chatId,
      `🔐 <b>Login so'rovi</b>\n\n` +
        `👤 Salom ${existingUser.first_name}!\n\n` +
        `🌐 JamolStroy websaytiga kirishga ruxsat berasizmi?\n\n` +
        `⚠️ <i>Faqat ishonchli manbalardan kelgan so'rovlarga ruxsat bering.</i>\n\n` +
        `🔗 Sayt: <code>${APP_URL}</code>`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Ruxsat berish", callback_data: `approve_login_${sessionToken}` },
              { text: "❌ Rad etish", callback_data: `reject_login_${sessionToken}` },
            ],
          ],
        },
        parse_mode: "HTML",
      },
    )
  } catch (error) {
    console.error("Web login handler error:", error)
    await sendMessage(chatId, "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
  }
}

async function handleLoginApproval(
  chatId: number,
  userId: number,
  messageId: number,
  sessionToken: string,
  approved: boolean,
) {
  try {
    console.log("Handling login approval:", userId, sessionToken, approved)

    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (!existingUser) {
      await sendMessage(chatId, "❌ Foydalanuvchi topilmadi.")
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
      await sendMessage(chatId, "❌ Xatolik yuz berdi.")
      return
    }

    const newText = approved
      ? `✅ <b>Login tasdiqlandi!</b>\n\n` +
        `🎉 Websaytda avtomatik tizimga kirasiz.\n\n` +
        `🌐 <code>${APP_URL}</code>\n\n` +
        `⏰ ${new Date().toLocaleString("uz-UZ")}`
      : `❌ <b>Login rad etildi</b>\n\n` +
        `🔒 Xavfsizlik uchun login so'rovi bekor qilindi.\n\n` +
        `⏰ ${new Date().toLocaleString("uz-UZ")}`

    await editMessage(chatId, messageId, newText)
  } catch (error) {
    console.error("Login approval error:", error)
    await sendMessage(chatId, "❌ Xatolik yuz berdi.")
  }
}

async function handleContact(chatId: number, userId: number, contact: any, user: any) {
  if (contact.user_id !== userId) {
    await sendMessage(chatId, "❌ Iltimos, o'z telefon raqamingizni yuboring.")
    return
  }

  try {
    console.log("Handling contact for user:", userId)

    const { data: existingUser } = await supabase.from("users").select("*").eq("telegram_id", userId).single()

    if (existingUser) {
      await sendMessage(chatId, "✅ Siz allaqachon ro'yxatdan o'tgansiz!")
      return
    }

    // Sessiyaga telefon raqamni saqlash
    userSessions.set(userId, {
      phoneNumber: contact.phone_number,
      step: "waiting_first_name",
      telegramData: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        language_code: user.language_code,
      },
    })

    await sendMessage(
      chatId,
      `✅ <b>Telefon raqamingiz qabul qilindi!</b>\n\n` +
        `📱 ${contact.phone_number}\n\n` +
        `👤 Endi ismingizni kiriting:`,
      {
        reply_markup: { remove_keyboard: true },
        parse_mode: "HTML",
      },
    )
  } catch (error) {
    console.error("Contact handler error:", error)
    await sendMessage(chatId, "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
  }
}

async function handleTextMessage(chatId: number, userId: number, text: string, user: any) {
  const session = userSessions.get(userId)
  if (!session) {
    await sendMessage(chatId, "❌ Iltimos, /start buyrug'ini yuboring.")
    return
  }

  try {
    if (session.step === "waiting_first_name") {
      session.firstName = text.trim()
      session.step = "waiting_last_name"
      userSessions.set(userId, session)

      await sendMessage(chatId, `👤 Ism: <b>${session.firstName}</b>\n\n📝 Endi familiyangizni kiriting:`, {
        parse_mode: "HTML",
      })
    } else if (session.step === "waiting_last_name") {
      session.lastName = text.trim()

      // Foydalanuvchini ma'lumotlar bazasiga qo'shish
      const tempToken = generateTempToken()

      const { data: newUser, error } = await supabase
        .from("users")
        .insert({
          telegram_id: userId,
          phone_number: session.phoneNumber,
          first_name: session.firstName,
          last_name: session.lastName,
          telegram_username: session.telegramData.username,
          telegram_language_code: session.telegramData.language_code,
          is_verified: true,
          temp_token: tempToken,
          temp_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single()

      if (error) {
        console.error("User creation error:", error)
        throw error
      }

      // Supabase auth user yaratish
      try {
        const { error: authError } = await supabase.auth.admin.createUser({
          email: `${userId}@telegram.local`,
          password: `tg_${userId}_${session.phoneNumber}`,
          email_confirm: true,
          user_metadata: {
            telegram_id: userId,
            first_name: session.firstName,
            last_name: session.lastName,
            phone_number: session.phoneNumber,
          },
        })

        if (authError) {
          console.error("Auth user creation error:", authError)
        }
      } catch (authError) {
        console.error("Auth error:", authError)
      }

      await sendMessage(
        chatId,
        `🎉 <b>Tabriklaymiz!</b>\n\n` +
          `✅ Ro'yxatdan o'tish muvaffaqiyatli yakunlandi!\n\n` +
          `👤 <b>${session.firstName} ${session.lastName}</b>\n` +
          `📱 <code>${session.phoneNumber}</code>\n\n` +
          `🏗️ Endi JamolStroy ilovasidan foydalanishingiz mumkin!`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🚀 Ilovani ochish", web_app: { url: `${APP_URL}?token=${tempToken}` } }]],
          },
          parse_mode: "HTML",
        },
      )

      // Sessionni tozalash
      userSessions.delete(userId)
    }
  } catch (error) {
    console.error("Text message handler error:", error)
    await sendMessage(chatId, "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.")
    userSessions.delete(userId)
  }
}

async function sendMessage(chatId: number, text: string, options: any = {}) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || "HTML",
        ...options,
      }),
    })

    const result = await response.json()
    if (!result.ok) {
      console.error("Send message error:", result)
    }
    return result
  } catch (error) {
    console.error("Send message error:", error)
  }
}

async function editMessage(chatId: number, messageId: number, text: string) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: "HTML",
      }),
    })

    const result = await response.json()
    if (!result.ok) {
      console.error("Edit message error:", result)
    }
    return result
  } catch (error) {
    console.error("Edit message error:", error)
  }
}

function generateTempToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}
