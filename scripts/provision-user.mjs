import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env")) loadEnvFile(".env");

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? "" : process.argv[index + 1] ?? "";
}

function promptPassword() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Set PROVISION_USER_PASSWORD in the environment when running without an interactive terminal.");
  }
  process.stdout.write("Kata sandi awal (min. 12 karakter): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          reject(new Error("Provisioning dibatalkan."));
          return;
        }
        if (character === "\r" || character === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (password.length) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        password += character;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

const email = option("email").trim().toLowerCase();
const fullName = option("name").trim();
const role = option("role");
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your trusted terminal.");
  process.exitCode = 1;
} else if (!email.includes("@") || fullName.length < 1 || fullName.length > 120 ||
    !["admin", "kasir", "gudang"].includes(role)) {
  console.error(
    "Usage: npm run provision-user -- --email person@example.com --name \"Nama Pengguna\" --role admin|kasir|gudang\n" +
    "The password is entered through a hidden terminal prompt.",
  );
  process.exitCode = 1;
} else {
  let password;
  try {
    password = process.env.PROVISION_USER_PASSWORD || await promptPassword();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Password prompt failed.");
    process.exitCode = 1;
  }
  if (process.exitCode) process.exitCode = 1;
  else if (password.length < 12) {
    console.error("Use a unique password of at least 12 characters.");
    process.exitCode = 1;
  } else {
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { count, error: countError } = await supabase
    .from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");

  if (countError) {
    console.error("Could not check for an existing administrator:", countError.message);
    process.exitCode = 1;
  } else if (!count && role !== "admin") {
    console.error("Create the initial admin account before provisioning other roles.");
    process.exitCode = 1;
  } else {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      console.error("Could not create the authentication user:", createError?.message ?? "No user was returned.");
      process.exitCode = 1;
    } else {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: created.user.id,
        full_name: fullName,
        role,
      });
      if (profileError) {
        const { error: rollbackError } = await supabase.auth.admin.deleteUser(created.user.id);
        console.error("Could not create the user profile:", profileError.message);
        if (rollbackError) console.error("The unlinked auth user also could not be removed:", rollbackError.message);
        process.exitCode = 1;
      } else {
        console.log(`Created ${role} account for ${email}.`);
      }
    }
  }
  }
}
