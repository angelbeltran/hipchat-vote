var http = require('request');
var cors = require('cors');
var uuid = require('uuid');
var url = require('url');

// This is the heart of your HipChat Connect add-on. For more information,
// take a look at https://developer.atlassian.com/hipchat/tutorials/getting-started-with-atlassian-connect-express-node-js
module.exports = function (app, addon) {
  var hipchat = require('../lib/hipchat')(addon);

  // simple healthcheck
  app.get('/healthcheck', function (req, res) {
    res.send('OK');
  });

  // Root route. This route will serve the `addon.json` unless a homepage URL is
  // specified in `addon.json`.
  app.get('/',
    function (req, res) {
      // Use content-type negotiation to choose the best way to respond
      res.format({
        // If the request content-type is text-html, it will decide which to serve up
        'text/html': function () {
          var homepage = url.parse(addon.descriptor.links.homepage);
          if (homepage.hostname === req.hostname && homepage.path === req.path) {
            res.render('homepage', addon.descriptor);
          } else {
            res.redirect(addon.descriptor.links.homepage);
          }
        },
        // This logic is here to make sure that the `addon.json` is always
        // served up when requested by the host
        'application/json': function () {
          res.redirect('/atlassian-connect.json');
        }
      });
    }
    );

  // This is an example route that's used by the default for the configuration page
  // https://developer.atlassian.com/hipchat/guide/configuration-page
  app.get('/config',
    // Authenticates the request using the JWT token in the request
    addon.authenticate(),
    function (req, res) {
      // The `addon.authenticate()` middleware populates the following:
      // * req.clientInfo: useful information about the add-on client such as the
      //   clientKey, oauth info, and HipChat account info
      // * req.context: contains the context data accompanying the request like
      //   the roomId
      res.render('config', req.context);
    }
    );

  // This is an example glance that shows in the sidebar
  // https://developer.atlassian.com/hipchat/guide/glances
  app.get('/glance',
    cors(),
    addon.authenticate(),
    function (req, res) {
      res.json({
        "label": {
          "type": "html",
          "value": "Hello World!"
        },
        "status": {
          "type": "lozenge",
          "value": {
            "label": "NEW",
            "type": "error"
          }
        }
      });
    }
    );

  // This is an example end-point that you can POST to to update the glance info
  // Room update API: https://www.hipchat.com/docs/apiv2/method/room_addon_ui_update
  // Group update API: https://www.hipchat.com/docs/apiv2/method/addon_ui_update
  // User update API: https://www.hipchat.com/docs/apiv2/method/user_addon_ui_update
  app.post('/update_glance',
    cors(),
    addon.authenticate(),
    function (req, res) {
      res.json({
        "label": {
          "type": "html",
          "value": "Hello World!"
        },
        "status": {
          "type": "lozenge",
          "value": {
            "label": "All good",
            "type": "success"
          }
        }
      });
    }
  );

  // This is an example sidebar controller that can be launched when clicking on the glance.
  // https://developer.atlassian.com/hipchat/guide/sidebar
  app.get('/sidebar',
    addon.authenticate(),
    function (req, res) {
      res.render('sidebar', {
        identity: req.identity
      });
    }
  );

  // This is an example dialog controller that can be launched when clicking on the glance.
  // https://developer.atlassian.com/hipchat/guide/dialog
  app.get('/dialog',
    addon.authenticate(),
    function (req, res) {
      res.render('dialog', {
        identity: req.identity
      });
    }
  );

  // Sample endpoint to send a card notification back into the chat room
  // See https://developer.atlassian.com/hipchat/guide/sending-messages
  app.post('/send_notification',
    addon.authenticate(),
    function (req, res) {
      var card = {
        "style": "link",
        "url": "https://www.hipchat.com",
        "id": uuid.v4(),
        "title": req.body.messageTitle,
        "description": "Great teams use HipChat: Group and private chat, file sharing, and integrations",
        "icon": {
          "url": "https://hipchat-public-m5.atlassian.com/assets/img/hipchat/bookmark-icons/favicon-192x192.png"
        }
      };
      var msg = '<b>' + card.title + '</b>: ' + card.description;
      var opts = { 'options': { 'color': 'yellow' } };
      hipchat.sendMessage(req.clientInfo, req.identity.roomId, msg, opts, card);
      res.json({ status: "ok" });
    }
  );

  // webhooks
  var votes = {} // TODO: turn this into a map/object
  function saveVote (poll, choice, user, timeStamp) {
    if (!poll || !choice || !user || !timeStamp) {
      return false
    }
    var voteList = votes[poll]
    if (!voteList) { // TODO: return a failure string?
      return false
    }

    for (var i = 0; i < voteList.length; i += 1) {
      if (voteList[i].user.name == user.name) {
        return false
      }
    }
    var vote = { choice, user, timeStamp }
    voteList.push(vote)
    console.log(poll, '-', user.name, '-', choice, '-', timeStamp)
    return true
  }

  // TODO: this isn't being used
  // removes the poll at midnight
  function clearVotesAtMidnight (poll) {
    var msInAMin = 1000 * 60
    var msInAnHr = msInAMin * 60
    setTimeout(() => {
      // check if it's a new day (the hour is 0)
      var hour = new Date().getHours()
      if (hour === 0) {
        // clear votes and start checking again close to the next midnight
        delete votes[poll]
        // votes[poll] = []
        // setTimeout(clearVotesAtMidnight, (11 * msInAnHour) + (55 * msInAMin), poll) // start checking again in 11 hours & 55 minutes
      } else {
        // try again in a minute
        clearVotesAtMidnight(poll)
      }
    }, msInAMin) // every minute check if it's a new day
  }

  function getPollAndChoice (txt) {
    console.log('getPollAndChoice:', txt)
    txt = txt.trim()
    var poll = ''
    var choice = ''

    if (!txt) {
      return { choice, poll }
    }

    console.log('getPollAndChoice: TEST 1')

    var ch
    if (txt[0] === "'") {
      ch = "'"
    } else if (txt[0] == '"') {
      ch = '"'
    }
    if (ch) {
      txt = txt.slice(1).trim()
      var i = txt.indexOf(ch)

      if (i !== -1) {
        poll = txt.slice(0, i).trim()
        txt = txt.slice(i + 1).trim()
      }
    } else {
      var splitText = txt.split(' ')
      poll = splitText[0]
      txt = splitText.slice(1).join(' ')
    }

    console.log('getPollAndChoice: TEST 2')

    ch = ''
    if (txt[0] === "'") {
      ch = "'"
    } else if (txt[0] == '"') {
      ch = '"'
    }
    if (ch) {
      txt = txt.slice(1).trim()
      var i = txt.indexOf(ch)

      if (i !== -1) {
        choice = txt.slice(0, i).trim()
        txt = txt.slice(i + 1).trim()
      }
    } else {
      var splitText = txt.split(' ')
      choice = splitText[0]
      txt = splitText.slice(1).join(' ')
    }

    console.log('getPollAndChoice: TEST 3')

    return { poll, choice }
  }

  app.post('/webhook-vote',
    addon.authenticate(),
    function (req, res) {
      if (req.body && req.body.event == 'room_message') {
        var item = req.body && req.body.item
        var message = item && item.message

        var voteString = message.message.slice('/vote'.length + 1)
        var voteData = getPollAndChoice(voteString)
        var poll = voteData.poll
        var choice = voteData.choice

        if (!poll) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Please provide a poll: /vote <poll> <choice>.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else if (!choice) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Please provide a choice: /vote <poll> <choice>.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else {
          var saved = saveVote(poll, choice, message.from, message.date)
          var resMsg

          if (saved) {
            resMsg = 'Your vote, ' + message.from.name + ' for ' + choice + ', has been taken.'
          } else {
            resMsg = 'You have already voted once on ' + topic + ' today.'
          }
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, resMsg)
            .then(function (data) {
              res.sendStatus(200);
            });
        }
      } else {
        res.sendStatus(200)
      }
    }
  );

  function voteString (vote) {
    return vote.user.name + ': ' + vote.choice + ' at ' + vote.timeStamp
  }

  app.post('/webhook-get-votes',
    addon.authenticate(),
    function (req, res) {
      if (req.body && req.body.event == 'room_message') {
        var item = req.body && req.body.item
        var message = item && item.message
        var poll = message.message.slice('/get-votes'.length + 1)

        if (!poll) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Please provide a poll: /votes <poll>. List all polls by typing /polls.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else if (!votes[poll].length) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'No votes have been recorded on poll ' + poll + '. Create a poll by typing /poll <poll>')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else {
          function voteToRow (vote) {
            return '<tr><td>' + vote.user.name + '</td><td>' + vote.choice + '</td><td>' + vote.timeStamp + '</td></tr>'
          }

          var header = '<tr><th>name</th><th>vote</th><th>time</th></tr>'
          var msg = '<table>' + header + votes[poll].map(voteToRow).join() + '</table>'
          var opts = { 'options': { 'color': 'yellow', format: 'html' } };
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, msg, opts)
            .then(function (data) {
              res.json({ status: "ok" });
              res.sendStatus(200);
            });
        }
      } else {
        res.sendStatus(200)
      }
    }
  );

  app.post('/webhook-remove-vote',
    addon.authenticate(),
    function (req, res) {
      if (req.body && req.body.event == 'room_message') {
        var item = req.body && req.body.item
        var message = item && item.message
        var user = message.from || {}
        var userName = user.name || ''
        var poll = message.message.slice('/remove-vote'.length + 1)

        if (!votes[poll]) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Please provide a poll: /remove-vote <poll>. List all polls by typing /polls.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else {
          votes[poll] = votes[poll].filter((vote) => vote.user.name !== userName)
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Your vote on poll ' + poll + ' has been removed.')
            .then(function (data) {
              res.sendStatus(200);
            });
        }
      } else {
        res.sendStatus(200)
      }
    }
  );

  app.post('/webhook-poll',
    addon.authenticate(),
    function (req, res) {
      console.log('ADD POLL')
      if (req.body && req.body.event == 'room_message') {
        var item = req.body && req.body.item
        var message = item && item.message
        var poll = message.message.slice('/poll'.length + 1)
        console.log('POLL:', poll)

        if (!poll) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Please provide a poll: /poll <poll>.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else if (votes[poll]) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Poll ' + poll + ' already exists. List all polls by typing /polls.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else {
          console.log('NEW POLL')
          votes[poll] = []
          clearVotesAtMidnight(poll)
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Poll "' + poll + '" added.')
            .then(function (data) {
              res.sendStatus(200);
            });
        }
      } else {
        res.sendStatus(200)
      }
    }
  );

  app.post('/webhook-remove-poll',
    addon.authenticate(),
    function (req, res) {
      if (req.body && req.body.event == 'room_message') {
        var item = req.body && req.body.item
        var message = item && item.message
        var poll = message.message.slice('/remove-poll'.length + 1)

        if (!poll) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Please provide a poll: /remove-poll <poll>.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else if (!votes[poll]) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Poll ' + poll + ' doesn\'t exist.')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else {
          delete votes[poll]
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Poll ' + poll + ' removed.')
            .then(function (data) {
              res.sendStatus(200);
            });
        }
      } else {
        res.sendStatus(200)
      }
    }
  );

  app.post('/webhook-get-polls',
    addon.authenticate(),
    function (req, res) {
      if (req.body && req.body.event == 'room_message') {
        var polls = Object.keys(votes)

        if (!polls.length) {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'There are no polls. Add a poll by typing "/poll <poll>".')
            .then(function (data) {
              res.sendStatus(200);
            });
        } else {
          hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'Current polls: "' + polls.join('", "') + '".')
            .then(function (data) {
              res.sendStatus(200);
            });
        }
      } else {
        res.sendStatus(200)
      }
    }
  );

  app.post('/webhook-help',
    addon.authenticate(),
    function (req, res) {
      var msg = '<table>'
      msg += '<tr><td>/poll {poll}</td></tr>'
      msg += '<tr><td>/get-polls</td></tr>'
      msg += '<tr><td>/remove-polls</td></tr>'
      msg += '<tr><td>/vote {poll} {choice}</td></tr>'
      msg += '<tr><td>/get-votes {poll}</td></tr>'
      msg += '<tr><td>/remove-vote {poll}</td></tr>'
      hipchat.sendMessage(req.clientInfo, req.identity.roomId, 'There are no polls. Add a poll by typing "/poll <poll>".')
        .then(function (data) {
          res.sendStatus(200);
        });
    }
  );


  // Notify the room that the add-on was installed. To learn more about
  // Connect's install flow, check out:
  // https://developer.atlassian.com/hipchat/guide/installation-flow
  addon.on('installed', function (clientKey, clientInfo, req) {
    var msg = '<table>'
    msg += '<tr><td>The ' + addon.descriptor.name + ' add-on has been installed in this room.</td></tr>'
    msg += '<tr><td>Add a poll by typing /poll <poll>.</td></tr>'
    msg += '<tr><td>Vote on a poll by typing /vote <poll> <choice>.</td></tr>'
    msg += '</table>'
    hipchat.sendMessage(clientInfo, req.body.roomId, msg);
/*
    hipchat.sendMessage(clientInfo, req.body.roomId, 'The ' + addon.descriptor.name + ' add-on has been installed in this room.');
    hipchat.sendMessage(clientInfo, req.body.roomId, 'Add a poll by typing /poll <poll>, and vote for it by typing /vote <poll> <choice>.');
*/
  });

  // Clean up clients when uninstalled
  addon.on('uninstalled', function (id) {
    addon.settings.client.keys(id + ':*', function (err, rep) {
      rep.forEach(function (k) {
        addon.logger.info('Removing key:', k);
        addon.settings.client.del(k);
      });
    });
  });

};
