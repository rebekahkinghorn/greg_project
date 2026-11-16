
// set up express
const express = require("express");
const path = require("path");

const app = express();

// use ejs
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));


// route to the index page
// title to display on page
app.get("/", (req, res) => {
  res.render("index", { title: "Greg Project" });
});


// set port to localhost:3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});


// middleware - parses incoming requests for use in req.body
app.use(express.urlencoded({ extended: true }));


// route to login page
app.get('/login', (req, res) => {
    res.render('login'); // .loggedIn is the request session loggedIn value
});


// route to log the user in
    // checks supabase for matching credentials
    app.post("/login", (req, res) => {
    const { user_email, user_password } = req.body;

    if (!user_email || !user_password) {
        return res.status(400).send("Email and password are required.");
    }

    //   check for what was returned
    console.log(Object.keys(req.body ?? {}));

    // Temporary check: don't print or display the password.
    res.send("Login form received. Next, connect it to Supabase Auth.");
    });
            // .catch(err => {
            //     console.error(err);
            //     res.redirect('/');
            // });
