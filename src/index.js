const express = require('express')
const app = express()
const path = require('path');
const port = 3000
const { create, engine } = require('express-handlebars');
var morgan = require('morgan')

const hbs = create({
    // Specify helpers which are only registered on this instance.
    helpers: {
        foo() { return 'FOO!'; },
        bar() { return 'BAR!'; }
    }
});
app.use(express.static(path.join(__dirname, "public")));

app.use(morgan('combined'))


app.engine('hbs', engine({
  extname: '.hbs',
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

console.log("PATH: ", path.join(__dirname, 'views'))


app.get('/', (req, res) => {
  res.render('home');
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
