var request = require('request');
var cheerio = require('cheerio');
var Table   = require('cli-table');
var wrap    = require('wordwrap')(9, 80);
var colors  = require('colors');
var config  = require('./config.js');
var store   = require('tough-cookie-filestore');
var fs      = require('fs');

module.exports = function () {

    /* Settings */
    this.schoolUrl;

    /* Driver */
    this.authenticationDriver;

    /* Request-vars */
    var request    = require('request');

    /* Path to cookie store */
    this.cookieStoreFilePath = (new config()).getHomeDir() + "/.itscookiestore";

    /* touch-cookie-filestore expects the cookie store file to exist */
    if (!fs.existsSync(this.cookieStoreFilePath )) {
        fs.writeFileSync(this.cookieStoreFilePath, '');
    }
    /* tough-cookie-filestore */
    this.cookieStore = new store(this.cookieStoreFilePath);

    /* cookie har with file store backend */
    this.cookieJar = request.jar(this.cookieStore);

    /* Credentials */
    this.username;
    this.password;

    /* Messages */
    this.messages = [];

    /* Notifications */
    this.notifications = [];

    /* Courses */
    this.courses = [];

    /* Bulletins */
    this.bulletins = {};

    /**
     * setAuthenticationDriver
     * - Loads an authentication driver for the client
     */
    this.setAuthenticationDriver = function (driver) {
        this.authenticationDriver = driver;
        this.schoolUrl = driver.schoolUrl;
    }

    /**
     * setCredentials
     * - Sets the credentials for the client
     */
    this.setCredentials = function (username, password) {
        this.username = username;
        this.password = password;
    }

    /**
     * authenticate
     * - Attempts to authenticate with the provided driver
     */
    this.authenticate = function (success, fail) {
        /* As of now there is no(?) reliable way of getting schoolUrl without invoking the
         * driver. So, as a workaround, we save the schoolUrl in the cookie store as well
         * with a custom domain key, and attempt to load it here. If it's set, we assume
         * there's a live session going.
         *
         * FIXME: Handle server-side timeouts (the cookies themselves have long (several months) expiry dates)
         */
        var cookies = this.cookieJar.getCookies('http://itslearningcli');
        if (cookies.length) {
            this.schoolUrl = cookies[0].value;
            success();
        }
        else {
            var self = this;
            this.authenticationDriver(
                this.username,
                this.password,
                this.cookieJar,
                /* Success */
                function () {
                    success();
                    /*
                     * After a successful request, save the schoolUrl to the cookie store.
                     */
                    self.cookieJar.setCookie('schoolUrl=' + self.schoolUrl, 'http://itslearningcli');
                },
                /* Fail */
                function (error) {
                    fail();
                }
            );
        }
    };

    /*
     * createOptions
     * - Returns an options dict with an auth cookie
     */
    this.createOptions = function(url) {
        return {
            jar: this.cookieJar,
            url: this.schoolUrl + url,
        };
    };

    /**
     * getUnreadMessages
     * - Returns the messages
     */
    this.getUnreadMessages = function () {
        return this.messages;
    }

    /**
     * getNotifications
     * - Returns the notifications
     */
    this.getNotifications = function () {
        return this.notifications;
    }

    /**
     * getCourses
     * - Returns the courses
     */
    this.getCourses = function () {
        return this.courses;
    }

    /**
     * getBulletins
     * - Returns the bulletins for a course
     */
    this.getBulletins = function (courseId) {
        return this.bulletins[courseId];
    }

    /**
     * fetchTree
     * - Recursively builds a tree of dirs and files for a course
     */
    this.fetchTree = function (courseId) {
        var self = this;

        var options = this.createOptions('ContentArea/ContentArea.aspx' +
            '?LocationID='+ courseId +'&LocationType=1');

        /* Find the root-folder-id (hacky) */
        request(options, function (error, response, html) {
            var rootDirId = html.match(/FolderID\=([0-9]+)\'/)[1];

            // This has to be recursively
            // https://www.itslearning.com/Folder/processfolder.aspx?FolderID=

        });
    }

    /**
     * fetchMessages
     * - Fetches all messages
     */
    this.fetchMessages = function (cb) {
        var self = this;

        var options = this.createOptions('Messages/InternalMessages.aspx' +
            '?MessageFolderId=1');

        request(options, function (error, response, html) {
            $ = cheerio.load(html, {
                normalizeWhitespace: true
            });
            var rawMessages = $('tr', 'table');

            rawMessages.each(function (index, rawMessage) {

                /* Skip first child: Header-controls*/
                if (index == 0)
                    return;

                var message = {
                    id     : $('input[name="_table:Select"]', rawMessage).attr('value'),
                    date   : $('.messageDate', rawMessage).text(),
                    read   : ($('td[style*="font-weight:bold;"]', rawMessage).length ? ' ' : '✓'),
                    from   : $('.messageFrom', rawMessage).text(),
                    subject: $('.messageSubject', rawMessage).text(),
                    body   : $('.messageBody', rawMessage).text()
                }

                self.messages.push(message);

                if (index == rawMessages.length - 1)
                    cb();

            });

        });
    }

    /**
     * fetchMessages
     * - Fetches all messages
     */
    this.fetchMessage = function (messageId, cb) {
        var self = this;

        var options = this.createOptions('Messages/view_message.aspx' +
                '?MessageFolderId=1&MessageId=' + messageId);

        request(options, function (error, response, html) {
            $ = cheerio.load(html, {
                normalizeWhitespace: true
            });

            var message = {
                from    : $('td', '.readMessageHeader').first().text(),
                subject : $('h1.ccl-pageheader').text(),
                body    : $('.readMessageBody').text().trim()
            }

            cb(message);
        });
    }

    /**
     * fetchNotifications
     * - Fetches notifications
     */
     this.fetchNotifications = function (cb) {
         var self = this;

         var options = this.createOptions('/Services/NotificationService.asmx'+
                '/GetPersonalNotifications');

         request(options, function (error, response, html) {
             $ = cheerio.load(html, {
                 normalizeWhitespace: true
             });

             var rawNotifications = $('ul').children('li');

             rawNotifications.each(function (index, rawMessage) {
                 var body = $(rawMessage).children('.h-dsp-tc').get(1);
                 var meta = $(body).children('div').children('.itsl-widget-extrainfo');

                 var notification = {
                     date    : $(meta).attr('title'),
                     from    : $(meta).children('a').text(),
                     title   : $(body).children('span').text()
                 }

                 self.notifications.push(notification);

                 if (index == rawNotifications.length - 1)
                     cb();
             });
         });
     }

    /**
     * fetchCourses
     * - Fetches the courses
     */
    this.fetchCourses = function (cb) {
        var self = this;

        var options = this.createOptions('Dashboard/Dashboard.aspx');

        request(options, function (error, response, html) {
            $ = cheerio.load(html, {
                normalizeWhitespace: true
            });

            var rawCourses = $('.itsl-widget-content-ul', '.itsl-cb-courses').children('li');

            rawCourses.each(function (index, rawCourse) {
                var course = {
                    id   : $(rawCourse).children('a').attr('href')
                              .replace('/main.aspx?CourseID=', ''),
                    title: $(rawCourse).children('a').text()
                }

                self.courses.push(course);

                if (index == rawCourses.length - 1)
                    cb();
            });
        });
    }

    /**
     * fetchBulletins
     * - Fetches the bulletins for a course
     */
    this.fetchBulletins = function (courseId, cb) {
        var self = this;

        var options = this.createOptions('Course/course.aspx?CourseId=' + courseId);

        request(options, function (error, response, html) {
            $ = cheerio.load(html, {
                normalizeWhitespace: true
            });

            self.bulletins[courseId] = [];
            var rawBulletins = $('.itsl-widget-content-ul', '.itsl-cb-news').children('li');

            rawBulletins.each(function (index, rawBulletin) {
                var bulletin = {
                    title   : $(rawBulletin).children('h2').text().trim(),
                    body    : $(rawBulletin).children('div.userinput').text(),
                    from    : $(rawBulletin).children('.itsl-widget-extrainfo').children('a').text()
                }

                self.bulletins[courseId].push(bulletin);

                if (index == rawBulletins.length - 1)
                    cb();
            });
        });
    }

    /**
     * printMessage
     * - Spits out formatted message
     */

    this.printMessage = function (message) {
        console.log("FROM:    ".bold.red + message.from.bold);
        console.log("SUBJECT: ".bold.red + message.subject.bold);
        console.log(wrap(message.body));
    }

    /**
     * bulletinsTable
     * - Spits out a formatted table of bulletins for a course
     */
     this.bulletinsTable = function (courseId) {
         var table = new Table({
             head: ['Title', 'From'],
             style: {
                 compact: true,
                 'padding-left': 1
             }
         });

         this.getBulletins(courseId).forEach(function (bulletin) {
             table.push([bulletin.title, bulletin.from]);
         });

         return table.toString();
     }

    /**
     * coursesTable
     * - Spits out a formatted table of each course
     */
     this.courseTable = function () {
         var table = new Table({
             head: ['Id', 'Course title'],
             style: {
                 compact: true,
                 'padding-left': 1
             }
         });

         this.getCourses().forEach(function (course) {
             table.push([course.id, course.title]);
         });

         return table.toString();
     }

    /**
     * inboxTable
     * - Spits out a formatted table of the inbox
     */
     this.inboxTable = function () {
         var table = new Table({
             head: ['Id', 'Read', 'Date', 'From', 'Subject'],
             style: {
                 compact: true,
                 'padding-left': 1
             }
         });

         this.getUnreadMessages().forEach(function (message) {
             table.push([message.id, message.read, message.date, message.from, message.subject]);
         });

         return table.toString();
     }

     /**
      * notificationTable
      * - Spits out a formatted table of the notifications
      */
      this.notificationTable = function () {
          var table = new Table({
              head: ['Date', 'From', 'Subject'],
              style: {
                  compact: true,
                  'padding-left': 1
              }
          });

          this.getNotifications().forEach(function (notification) {
              table.push([notification.date, notification.from, notification.title]);
          });

          return table.toString();
      }
}
