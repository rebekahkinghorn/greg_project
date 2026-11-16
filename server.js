// Load local environment variables during development.
// Vercel supplies its environment variables at runtime.
require("dotenv").config();

// Import the web framework, path helpers, and Supabase SDKs used by this server.
const express = require("express");
const path = require("path");
const {
  createClient,
} = require("@supabase/supabase-js");
const {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} = require("@supabase/ssr");

// Create the Express application that Vercel runs and that npm start runs locally.
const app = express();

// Tell Express to render page templates from the views folder using EJS.
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Vercel serves files placed in /public. This also serves them locally.
// Serve local static assets and parse browser form/JSON request bodies before routes run.
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Read project connection settings from local .env or Vercel environment variables.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

// Stop early with a clear message when the basic Supabase connection settings are missing.
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env locally and in Vercel."
  );
}

// Create a request-specific Supabase client. Supabase SSR stores the
// signed-in user's session in cookies and refreshes those cookies as needed.
// Build a user-scoped client for this request so Supabase Auth can read/write session cookies.
function createUserClient(req, res) {
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
// Keep the auth cookies scoped to this site and protected from client-side JavaScript.
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
    cookies: {
// Read the cookies sent by the browser so Supabase can restore the current session.
      getAll() {
        return parseCookieHeader(req.headers.cookie || "");
      },
// Send Supabase session updates (including refreshes and sign-out removals) back to the browser.
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          res.append(
            "Set-Cookie",
            serializeCookieHeader(name, value, options)
          );
        }

        for (const [name, value] of Object.entries(headers || {})) {
          res.setHeader(name, value);
        }
      },
    },
  });
}

// This client uses the private key and must only be used by protected
// server routes. It can manage Supabase Auth users and bypasses RLS.
// Build a separate privileged client for Auth Admin API operations; never send it to the browser.
function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing SUPABASE_SECRET_KEY environment variable.");
  }

  return createClient(SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

// Check the signed-in user's identity with Supabase, then require the trusted
// app_metadata role Cougar AI uses for administrators.
// Protect maintenance routes by verifying the session and trusted admin role on every request.
async function requireAdmin(req, res, next) {
  try {
    const userClient = createUserClient(req, res);
    const { data, error } = await userClient.auth.getUser();
    const user = data?.user;

    if (error || !user) {
      return res.redirect("/login");
    }

    if (user.app_metadata?.role !== "admin") {
      return res.status(403).send("Administrator access required.");
    }

    req.adminUser = user;
    req.userClient = userClient;
    next();
  } catch (error) {
    next(error);
  }
}

// Landing page. The EJS template can use isAdmin to show or hide its button.
// Render the landing page and tell its EJS template whether this visitor is an admin.
app.get("/", async (req, res, next) => {
  try {
    const userClient = createUserClient(req, res);
    const { data } = await userClient.auth.getUser();
    const user = data?.user || null;
    const isAdmin = user?.app_metadata?.role === "admin";
    const messages = {
      "invalid-login": "Email or password was incorrect.",
      "not-admin": "This account does not have administrator access.",
    };

    res.render("index", {
      title: "Greg Project",
      user,
      isAdmin,
      error: messages[req.query.error] || null,
    });
  } catch (error) {
    next(error);
  }
});

// Show the login form.
// Render the login page and map safe error codes to messages for the user.
app.get("/login", (req, res) => {
  const messages = {
    "invalid-login": "Email or password was incorrect.",
    "not-admin": "This account does not have administrator access.",
  };

  res.render("login", {
    error: messages[req.query.error] || null,
  });
});

// Sign in through Supabase Auth. Only users with the trusted admin role
// receive access to the maintenance area.
// Receive the login form, authenticate with Supabase Auth, and admit admins only.
app.post("/login", async (req, res, next) => {
  const email = String(req.body.user_email || "").trim();
  const password = String(req.body.user_password || "");

  if (!email || !password) {
    return res.status(400).render("login", {
      error: "Enter both your email and password.",
    });
  }

  try {
    const userClient = createUserClient(req, res);
    const { data, error } = await userClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data?.user) {
      return res.redirect("/?error=invalid-login");
    }

    if (data.user.app_metadata?.role !== "admin") {
      await userClient.auth.signOut({ scope: "local" });
      return res.redirect("/?error=not-admin");
    }

    return res.redirect("/");
  } catch (error) {
    next(error);
  }
});

// Logout clears the Supabase session cookies.
// End this browser session in Supabase Auth, which clears its session cookies.
app.post("/logout", async (req, res, next) => {
  try {
    const userClient = createUserClient(req, res);
    await userClient.auth.signOut({ scope: "local" });
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

// Display the protected user-maintenance page.
// Render the protected user-maintenance page with a page of Supabase Auth users.
app.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const perPage = 100;
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return res.status(500).send("Could not load Auth users.");
    }

    res.render("users", {
      users: data.users,
      page,
      adminUser: req.adminUser,
    });
  } catch (error) {
    next(error);
  }
});

// Read Auth users for the maintenance page.
// Return a JSON list for the maintenance interface; never include user passwords.
app.get("/api/users", requireAdmin, async (req, res, next) => {
  try {
    // Prevent cached responses from showing an outdated Auth user list.
    res.set("Cache-Control", "no-store");
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const perPage = 100;
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return res.status(500).json({ error: "Could not load Auth users." });
    }

    res.json({
      users: data.users.map((user) => ({
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        user_metadata: user.user_metadata,
        app_metadata: user.app_metadata,
      })),
      page,
      perPage,
    });
  } catch (error) {
    next(error);
  }
});

// Create an Auth account. Passwords are sent to Supabase Auth and are never
// stored in an application table.
// Create an Auth account through the privileged Supabase Admin API.
app.post("/api/users", requireAdmin, async (req, res, next) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: String(req.body.display_name || "").trim(),
      },
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      user: {
        id: data.user.id,
        email: data.user.email,
        created_at: data.user.created_at,
        user_metadata: data.user.user_metadata,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Update an Auth account's email, password, or display name.
// Update only the submitted email, password, or display name for one Auth account.
app.patch("/api/users/:id", requireAdmin, async (req, res, next) => {
  const attributes = {};

  if (typeof req.body.email === "string" && req.body.email.trim()) {
    attributes.email = req.body.email.trim();
  }

  if (typeof req.body.password === "string" && req.body.password) {
    attributes.password = req.body.password;
  }

  if (typeof req.body.display_name === "string") {
    attributes.user_metadata = {
      display_name: req.body.display_name.trim(),
    };
  }

  if (Object.keys(attributes).length === 0) {
    return res.status(400).json({ error: "Provide a field to update." });
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.auth.admin.updateUserById(
      req.params.id,
      attributes
    );

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        user_metadata: data.user.user_metadata,
        updated_at: data.user.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Delete an Auth account. Prevent an admin from deleting their own account
// while signed in to this maintenance site.
// Delete one Auth account, while preventing the current admin from deleting themself.
app.delete("/api/users/:id", requireAdmin, async (req, res, next) => {
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({
      error: "You cannot delete the admin account currently in use.",
    });
  }

  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient.auth.admin.deleteUser(req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Display the protected CRUD page for the public.greg_table records.
app.get("/records", requireAdmin, (req, res) => {
  res.render("records", { adminUser: req.adminUser });
});

// Read the greg_table rows for the records page. Disable caching so changes
// made by create, update, or delete appear immediately when the list reloads.
app.get("/api/records", requireAdmin, async (req, res, next) => {
  res.set("Cache-Control", "no-store");

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("greg_table")
      .select("id, created_at, name, description")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ records: data });
  } catch (error) {
    next(error);
  }
});

// Create a row in greg_table. The database supplies id and created_at.
app.post("/api/records", requireAdmin, async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (!name) {
    return res.status(400).json({ error: "Record name is required." });
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("greg_table")
      .insert({ name, description })
      .select("id, created_at, name, description")
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ record: data });
  } catch (error) {
    next(error);
  }
});

// Update a row by its int8 id. Only name and description are editable.
app.patch("/api/records/:id", requireAdmin, async (req, res, next) => {
  const id = String(req.params.id);
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: "Record ID must be a number." });
  }
  if (!name) {
    return res.status(400).json({ error: "Record name is required." });
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("greg_table")
      .update({ name, description })
      .eq("id", id)
      .select("id, created_at, name, description")
      .maybeSingle();

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: "Record not found." });
    }

    res.json({ record: data });
  } catch (error) {
    next(error);
  }
});

// Delete a row by its int8 id from the protected records page.
app.delete("/api/records/:id", requireAdmin, async (req, res, next) => {
  const id = String(req.params.id);

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: "Record ID must be a number." });
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("greg_table")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: "Record not found." });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
// Return readable errors without exposing keys or stack traces to visitors.
// Handle unexpected errors centrally without returning secrets or stack traces to visitors.
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send("The server could not complete that request.");
});

// Vercel imports the Express app. Locally, npm start runs the listener.
// Start a local HTTP listener only when run directly; Vercel imports the Express app instead.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log("Server running at http://localhost:" + PORT);
  });
}

// Export the app so Vercel can turn it into a serverless function.
module.exports = app;






