const { create } = require('express-handlebars');
const path = require('path');

function setupHandlebars(app) {
    const hbs = create({
        extname: '.hbs',
        helpers: {
            statusIsActive: function(status) {
                return status === "ACTIVE";
            },
            eq: function(a, b, options) {
                if (arguments.length === 3) {
                    if (a === b) {
                        return options.fn(this);
                    } else {
                        return options.inverse(this);
                    }
                }
                return a === b;
            },
            foo() { return 'FOO!'; },
            bar() { return 'BAR!'; }
        }
    });

    app.engine('hbs', hbs.engine);
    app.set('view engine', 'hbs');
    

    // Nếu views trong src
    app.set('views', path.join(__dirname, '..', 'views'));
}

module.exports = { setupHandlebars };

