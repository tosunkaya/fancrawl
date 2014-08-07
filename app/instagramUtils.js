//  app/instagramUtils.js


//  =============================================================================
//  SET UP AND GLOBAL VARIABLES
//  =============================================================================

var https                     = require('https'),
    ig                        = require('instagram-node').instagram(),
    _                         = require('underscore'),
    crypto                    = require('crypto'),
    request                   = require('request'),
    redirect_uri              = process.env.INSURIREDIRECT,
    mysql                     = require('mysql'),
    timer_state               = true,
    lean_timer                = true,
    timer_call                = false,
    random_second             = (Math.floor(((Math.random() * 30) + 0)*1000)) + 60000, // random millisecond generator between 30 ~ 0 sec
    connection                = mysql.createConnection({
                                  host: 'localhost',
                                  user: 'root',
                                  password: process.env.MYSQLPASSWORD,
                                  database: 'fancrawl'
                                });

    connection.connect(function(err) {
                                      if (err) {
                                        console.error('error connecting: ' + err.stack);
                                        return;
                                      }

                                      console.log('connected as id ' + connection.threadId);
                                     });

    ig.use({
            client_id: process.env.FANCRAWLCLIENTID,
            client_secret: process.env.FANCRAWLCLIENTSECRET
           });

// TODO - cross check with secure database on unfollowing.
// TODO - fix node-sass on server side

//  =============================================================================
//  UTILITIES CALLED BY MAIN SECTIONS
//  =============================================================================


//  ZERO = neutral timer function ===============================================
  var check_timer             = function() {
    if (timer_call) {
      return;
    } else {
      timer_state = false;
      timer_call = true;
      if (lean_timer){
        console.log("Timer 1.5 minute wait");
        var m = new Date();
        console.log(m);
        setTimeout(
          function(){
            if(lean_timer){
              timer_state = true;
              timer_call = false;
            } else {
              timer_call = false;
              check_timer();
            }
        // }, random_second); // (1~1.5 minute delay)
        }, 90000); // (1~1.5 minute delay)
      } else {
        console.log("Timer Extended by 30 minutes");
        setTimeout(
          function(){
            lean_timer = true;
            timer_state = true;
            timer_call = false;
        }, 1800000); // (30 minute delay)
      }
    }

    };
    check_timer();  // autoloads on start to make sure to wait 1 minute

//  ZERO = unfollow function ====================================================
  var GO_unfollow             = function (fancrawl_instagram_id, new_instagram_following_id, ip_address){
    if (timer_state) {
      check_timer();
        connection.query('SELECT token from access_right where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
        if (err) throw err;
        // instagram header secret system
        var hmac = crypto.createHmac('SHA256', process.env.FANCRAWLCLIENTSECRET);
            hmac.setEncoding('hex');
            hmac.write(ip_address);
            hmac.end();
        var hash = hmac.read();

        // Set the headers
        var headers = {
            'X-Insta-Forwarded-For': ip_address+'|'+hash
        }

        // Configure the request
        var options = {
            uri: 'https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship',
            qs: {'access_token': rows[0].token},
            method: 'POST',
            headers: headers,
            form:{action:'unfollow'}
        }

        request(options, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            console.log("unfollow body ("+new_instagram_following_id+"): ", body); // Print the google web page.
            if (body && body.data && body.data.outgoing_status && body.data.outgoing_status === "none") {
              connection.query('UPDATE beta_followers set following_status = 0 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                if (err) throw err;
              });
            }
          } else if (error) {
            console.log('GO_unfollow error ('+new_instagram_following_id+'): ', error);
          }
        });
      });
    } else {
      setTimeout(
        function(){
          GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
      }, 5000 ); // time between adding new followers (5 sec or so wait)
    }
    }

//  ZERO = follow crawler function ==============================================
  var GO_follow               = function(fancrawl_instagram_id, new_instagram_following_id, ip_address){

    // CHECK STATE
    connection.query('SELECT state FROM access_right where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
      if (err) throw err;

      // GOES WITH PROCESS IF STARTED
      if (rows[0].state === 'started') {
        var next_follower = ( parseInt(new_instagram_following_id) + 1);

        connection.query('SELECT token from access_right where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
          if (err) throw err;

          // CHECKS RELATIONSHIP WITH NEW INSAGRAM USER
          request('https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship?access_token='+rows[0].token, function (error, response, body) {
            var pbody = JSON.parse(body);

            // DOES NOT EXIST - GO_FOLLOW THE NEXT USER
            if (pbody && pbody.meta && pbody.meta.error_message && pbody.meta.error_message === "this user does not exist") {
              // new instagram user does not exist
              console.log(new_instagram_following_id+" does not exist");
              // add 1 to the database and run GO_follow again with new value
              connection.query('UPDATE access_right set last_following_id = "'+next_follower+'" where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                if (err) throw err;
                // if (timer_state) {
                  // check_timer();
                  GO_follow( fancrawl_instagram_id, next_follower, ip_address);
                // } else {
                  // setTimeout(
                    // function(){
                      // GO_follow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                  // }, 5000 + random_second); // time between adding new followers (5 sec or so wait)
                // }
              });

            // OAUTH TIME LIMIT REACHED LET TIMER KNOW AND TRIES AGAIN
            } else if( pbody && pbody.meta && pbody.meta.error_type && pbody.meta.error_type === "OAuthRateLimitException" ) {
              // max number of calls reached per hour timout 5
              console.log("GO_follow limit reach ("+new_instagram_following_id+"): ", body);
              lean_timer = false;
              check_timer();
              setTimeout(
                function(){
                  GO_follow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
              }, 600000); // time between adding new followers (10 min or so wait)

            // INSTAGRAM USER FOLLOWS YOU BACK
            } else if (pbody && pbody.data && pbody.data.incoming_status && pbody.data.incoming_status === "followed_by") {
              // new instagram user follows you back!
              console.log(new_instagram_following_id+" is following you back");
              // change state in DB and move on to the next one!
              connection.query('UPDATE access_right set last_following_id = "'+next_follower+'" where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                if (err) throw err;
                connection.query('UPDATE beta_followers set followed_by_status = 1 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                  if (err) throw err;
                  // unfollow user that already follows back
                  GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                  if ( timer_state ) {
                    check_timer();
                    GO_follow( fancrawl_instagram_id, next_follower, ip_address);
                  } else {
                    setTimeout(
                      function(){
                        GO_follow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                    }, 5000); // time between adding new followers (5 sec or so wait)
                  }
                });
              });

            // ALREADY FOLLOWING USER SO SKIP TO NEW USER
            } else if (pbody && pbody.data && pbody.data.outgoing_status && pbody.data.outgoing_status === "follows") {
              // fancrawl user follows
              console.log("you are already following user: "+new_instagram_following_id);
              // add 1 to the database and run GO_follow again with new value
              connection.query('UPDATE access_right set last_following_id = "'+next_follower+'" where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                if (err) throw err;
                // if ( timer_state ) {
                  // check_timer();
                  GO_follow( fancrawl_instagram_id, next_follower, ip_address);
                // } else {
                  // setTimeout(
                    // function(){
                      // GO_follow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                  // }, 5000 + random_second); // time between adding new followers (5 sec or so wait)
                // }
              });

            // ALREADY REQUESTED TO FOLLOW USER SO SKIP TO NEW USER
            } else if (pbody && pbody.data && pbody.data.outgoing_status && pbody.data.outgoing_status === "requested") {
              // fancrawl user requested to follow
              console.log(new_instagram_following_id+" has already been requested to be followed");
              // add 1 to the database and run GO_follow again with new value
              connection.query('UPDATE access_right set last_following_id = "'+next_follower+'" where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                if (err) throw err;
                // if ( timer_state ) {
                  // check_timer();
                  GO_follow( fancrawl_instagram_id, next_follower, ip_address);
                // } else {
                  // setTimeout(
                    // function(){
                      // GO_follow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                  // }, 5000 + random_second); // time between adding new followers (5 sec or so wait)
                // }
              });

            } else if (error) {
              console.log("GO_follow error ("+new_instagram_following_id+"): ", error);

            } else {
              console.log("in new follower");
              if ( timer_state ) {
                check_timer();
                // add 1 to the database and run GO_follow again with new value
                // but also check on it with other setTimeout

                connection.query('SELECT token from access_right where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                  if (err) throw err;
                  var token = rows[0].token;
                  // instagram header secret system
                  var hmac = crypto.createHmac('SHA256', process.env.FANCRAWLCLIENTSECRET);
                      hmac.setEncoding('hex');
                      hmac.write(ip_address);
                      hmac.end();
                  var hash = hmac.read();

                  // Set the headers
                  var headers = {
                      'X-Insta-Forwarded-For': ip_address+'|'+hash
                      };

                  // Configure the request
                  var options = {
                      uri: 'https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship',
                      qs: {'access_token': token},
                      method: 'POST',
                      headers: headers,
                      form:{action:'follow'}
                      };

                  request(options, function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                      connection.query('UPDATE access_right set last_following_id = "'+next_follower+'" where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                        if (err) throw err;
                        console.log("GO_follow body ("+new_instagram_following_id+"): ", body);
                        connection.query('INSERT INTO beta_followers SET fancrawl_instagram_id = '+fancrawl_instagram_id+', added_follower_instagram_id = '+new_instagram_following_id, function(err, rows, fields) {
                          if (err) throw err;
                          setTimeout(
                            function(){
                              console.log('waited 5 minutes for follower: '+new_instagram_following_id);

                              request('https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship?access_token='+token, function (error, response, body) {
                                var pbody = JSON.parse(body);

                                if (pbody && pbody.data && pbody.data.incoming_status && pbody.data.incoming_status === "followed_by") {
                                  console.log('after 5 min user '+new_instagram_following_id+' follows you back');
                                  connection.query('UPDATE beta_followers set followed_by_status = 1, count = 1 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                    if (err) throw err;
                                    GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                                  });
                                } else {
                                  connection.query('UPDATE beta_followers set count = 1 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                    if (err) throw err;
                                    setTimeout(
                                      function(){
                                        console.log('waited 1 hour for follower: '+new_instagram_following_id);
                                        request('https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship?access_token='+token, function (error, response, body) {
                                          var pbody = JSON.parse(body);

                                          if (pbody && pbody.data && pbody.data.incoming_status && pbody.data.incoming_status === "followed_by") {
                                            console.log('after 1 hour user '+new_instagram_following_id+' follows you back');
                                            connection.query('UPDATE beta_followers set followed_by_status = 1, count = 2 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                              if (err) throw err;
                                              GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                                            });
                                          } else {
                                            connection.query('UPDATE beta_followers set count = 2 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                              if (err) throw err;
                                              setTimeout(
                                                function(){
                                                  console.log('waited 1 day for follower: '+new_instagram_following_id);
                                                  request('https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship?access_token='+token, function (error, response, body) {
                                                    var pbody = JSON.parse(body);
                                                    if (pbody && pbody.data && pbody.data.incoming_status && pbody.data.incoming_status === "followed_by") {
                                                      console.log('after 1 day user '+new_instagram_following_id+' follows you back');
                                                      connection.query('UPDATE beta_followers set followed_by_status = 1, count = 3 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                                        if (err) throw err;
                                                        GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                                                      });
                                                    } else {
                                                      connection.query('UPDATE beta_followers set count = 3 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                                        if (err) throw err;
                                                        setTimeout(
                                                          function(){
                                                            console.log('waited 2 days for follower: '+new_instagram_following_id);
                                                            request('https://api.instagram.com/v1/users/'+new_instagram_following_id+'/relationship?access_token='+token, function (error, response, body) {
                                                              var pbody = JSON.parse(body);
                                                              if (pbody && pbody.data && pbody.data.incoming_status && pbody.data.incoming_status === "followed_by") {
                                                                console.log('after 2 days user '+new_instagram_following_id+' follows you back');
                                                                connection.query('UPDATE beta_followers set followed_by_status = 1, count = 4 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                                                  if (err) throw err;
                                                                  GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                                                                });
                                                              } else {
                                                                connection.query('UPDATE beta_followers set count = 4 where fancrawl_instagram_id = "'+fancrawl_instagram_id+'" AND added_follower_instagram_id = "'+new_instagram_following_id+'"', function(err, rows, fields) {
                                                                  console.log('sorry after 2 days user '+new_instagram_following_id+' did not follow you back');
                                                                  if (err) throw err;
                                                                  GO_unfollow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                                                                });
                                                              }
                                                            });
                                                        }, 172800000); // third time to check if user added back (2 days)
                                                      });
                                                    }
                                                  });
                                              }, 86400000); // third time to check if user added back (1 day)
                                            });
                                          }
                                        });
                                    }, 3600000); // second time to check if user added back (1 hour)
                                  });
                                }
                              });

                          }, 300000); // first time to check if user added back (5 minutes)
                        });

                        if (timer_state) {
                          check_timer();
                          connection.query('SELECT last_following_id from access_right where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                            if (err) throw err;
                            GO_follow( fancrawl_instagram_id, rows[0].last_following_id, ip_address);
                          });
                        } else {
                          setTimeout(
                            function(){
                              connection.query('SELECT last_following_id from access_right where fancrawl_instagram_id = "'+fancrawl_instagram_id+'"', function(err, rows, fields) {
                                if (err) throw err;
                                GO_follow( fancrawl_instagram_id, rows[0].last_following_id, ip_address);
                              });
                          }, 5000); // time between adding new followers (5 sec or so wait)
                        }
                      });

                    } else {
                      // IF ERROR  WAIT FOR TIMER AND RESTART
                      console.log("GO_Follow error ("+new_instagram_following_id+"): ", error);
                      console.log("GO_Follow body on error ("+new_instagram_following_id+"): ", body);

                      // TODO make it specific to error:
                      // {"meta":{"error_type":"OAuthRateLimitException","code":429,"error_message":"The maximum number of requests per hour has been exceeded. You have made 128 requests of the 60 allowed in the last hour."}}

                      lean_timer = false;
                      check_timer();
                      GO_follow( fancrawl_instagram_id, new_instagram_following_id, ip_address );
                    }
                  });
                });

              } else {
                setTimeout(
                  function(){
                    GO_follow(fancrawl_instagram_id, new_instagram_following_id, ip_address);
                }, 5000); // time between adding new followers (5 sec or so wait)
              }
            }
          });
        });

      } else {
        console.log(new_instagram_following_id+' was stopped');
      }

    });

    };

//  ZERO = server restart check =================================================
  var GO_start                 = function(){

    // TODO when start check back on previous data to make sure that the it is on count 4... if not.. then they should check again...
    // means refactoring the setTimeout.
    // var start_started = function(limited_user){
    var start_started = function(limited_user){
      connection.query('SELECT fancrawl_instagram_id, last_following_id FROM access_right where state = "started"', function(err, rows, fields) {
        if (err) throw err;
        if(rows) {
          for (var i = 0; i < rows.length; i++){
            if ( rows[i].fancrawl_instagram_id && rows[i].last_following_id ){
            console.log("SERVER RESTART STARTING FETCH AGAIN");
              // GO_follow(rows[i].fancrawl_instagram_id, rows[i].last_following_id, rows[i].last_ip);
              GO_follow(rows[i].fancrawl_instagram_id, rows[i].last_following_id, process.env.LOCALIP);
            }
          }
        }
      });
    };
    start_started();

    // var limit_check = function(){
    //   connection.query('SELECT fancrawl_instagram_id FROM access_right where state = "limit" ', function(err, rows, fields) {
    //     if (err) throw err;
    //     if(rows) {
    //       for (var i = 0; i < rows.length; i++){
    //         if ( rows[i].fancrawl_instagram_id ){
    //           setTimeout(
    //             function(){
    //               start_started(rows[i].fancrawl_instagram_id);
    //               limit_check();
    //           }, 300000); // first time to check if user added back (5 minutes)

    //         } else {
    //           // done with check
    //         }
    //       }
    //     }
    //   })
    // };
    // limit_check();

    }();


//  =============================================================================
//  MAIN SECTIONS
//  =============================================================================

//  FIRST = load landing page '/' ===============================================
  exports.login               = function(req, res) {
    console.log("loggedin");
    res.render('./partials/login.ejs');
    };

//  SECOND = link to instagram authentication api for access token ==============
  exports.authorize_user      = function(req, res) {
    console.log("authorizing");
    res.redirect(ig.get_authorization_url(redirect_uri, { scope: ['likes', 'comments', 'relationships'], state: 'a state' }));
    };

//  THIRD = handle instagram response and check access rights ===================
  exports.handleauth          = function(req, res) {
    // queryCode           = req.query.code;

    ig.authorize_user(req.query.code, redirect_uri, function(err, result) {

      // profile_picture     = result.user.profile_picture;
      // token               = result.access_token;
      // full_name           = result.user.full_name;
      // userName            = result.user.username;
      // id                  = result.user.id;

      if (err) {
        console.log("Didn't work - most likely the Instagram secret key has been changed... For developer: Try rebooting the server. " + err.body);
        res.redirect('/404/');
        return;
      } else {
        connection.query('SELECT fancrawl_username FROM access_right where fancrawl_instagram_id = '+ result.user.id, function(err, rows, fields) {
          if (err) throw err;

          if ( rows && rows[0] && rows[0].fancrawl_username && rows[0].fancrawl_username === result.user.username){
            console.log("User granted");

              connection.query('UPDATE access_right set fancrawl_full_name = "'+result.user.full_name+'", code = "'+req.query.code+'", token = "'+result.access_token+'", fancrawl_profile_picture = "'+result.user.profile_picture+'" where fancrawl_instagram_id = '+ result.user.id, function(err, rows, fields) {
                if (err) throw err;
                res.redirect('/fresh?user='+result.user.username+'&id='+result.user.id);
                return;
              });

            return;
          } else {
            console.log("User not granted");
            // connection.end();
            res.redirect('/404/');
            return;
          }
        });

      }
    });
    };

//  FOURTH = go grab instagram follower/ed data and show it =====================
  exports.fresh               = function(req, res) {

    if (JSON.stringify(req.query).length !== 2 && req.query.user !== undefined && req.query.id !== undefined) {
      console.log("has valid structure");

      // check access rights from database.
      connection.query('SELECT fancrawl_username FROM access_right where fancrawl_instagram_id = '+ req.query.id, function(err, rows, fields) {
        if (err) throw err;

        if (rows[0] === undefined || rows[0].fancrawl_username === undefined || rows[0].fancrawl_username !== req.query.user){
          console.log("User not granted");
          res.redirect('/404/');
          return;

        } else {
          console.log("User granted");
            // check state for particular fancrawl_instagram_id
            connection.query('SELECT state FROM access_right where fancrawl_instagram_id = "'+req.query.id+'"', function(err, rows, fields) {
              if (err) throw err;
              if (rows[0].state === "empty") {
                console.log("////////////////////////////");
                console.log("In a empty state");

                // update state to busy to prevent multiple edition.
                connection.query('UPDATE access_right set state = "busy" where fancrawl_instagram_id = "'+req.query.id+'"', function(err, rows, fields) {
                  if (err) throw err;

                  // instagram API calls
                  // go get current instagram followed_by users
                  var paginationFollowed_by = function (err, users, pagination, limit) {
                    if(err){
                      console.log("fresh error - Pagination: ", err);
                    } else {

                      // TODO this does not take asynchronous process into consideration
                      //puts in mysql each users
                      for (var i = 0; i < users.length; i++) {
                        connection.query('INSERT INTO s_followed_by set fancrawl_instagram_id = "'+req.query.id+'", followed_by_full_name = "'+users[i].full_name+'", followed_by_username = "'+users[i].username+'", followed_by_id = "'+users[i].id+'"', function(err, rows, fields) {
                          if (err) throw err;
                        });
                      };

                      // goes through each pagination to add to the followers list.
                      if (pagination && pagination.next) {
                        pagination.next(paginationFollowed_by);
                      } else {
                      console.log('Done with s_followed_by list');

                        // instagram API calls
                        // go get current instagram following users
                        var paginationFollowing = function (err, users, pagination, limit) {
                          if(err){
                            console.log("fresh error - paginationFollowing: ", err);
                          } else {

                            // TODO this does not take asynchronous process into consideration
                            //puts in mysql each users
                            for (var i = 0; i < users.length; i++) {
                              connection.query('INSERT INTO s_following set fancrawl_instagram_id = "'+req.query.id+'", following_full_name = "'+users[i].full_name+'", following_username = "'+users[i].username+'", following_id = "'+users[i].id+'"', function(err, rows, fields) {
                                if (err) throw err;
                              });
                            };

                            // goes through each pagination to add to the followers list.
                            if (pagination && pagination.next) {
                              pagination.next(paginationFollowing);
                            } else {
                            console.log('Done with s_following list');

                            // update database status from busy to fresh
                            connection.query('UPDATE access_right set state = "fresh" where fancrawl_instagram_id = "'+req.query.id+'"', function(err, rows, fields) {
                              if (err) throw err;
                            });

                            // variables to ejs pages
                            var followed_by;
                            var following;

                            connection.query('SELECT count(*) from s_followed_by', function(err, rows, fields) {
                              if (err) throw err;
                              followed_by = rows[0]['count(*)'];

                              connection.query('SELECT count(*) from s_following', function(err, rows, fields) {
                                if (err) throw err;
                                following = rows[0]['count(*)'];
                                  console.log('following '+following+' and is followed_by '+followed_by+' instagram users');
                                  console.log('Done with s_following list');
                                  res.render('./partials/dashboard.ejs',  {
                                                                            'state': 'fresh',
                                                                            'followed_by': followed_by,
                                                                            'following': following
                                                                          })
                                return;
                              });
                            });

                            return;
                            };
                          };
                        };


                        ig.user_follows(req.query.id, paginationFollowing);
                      }
                    }
                  };

                  ig.user_followers(req.query.id, paginationFollowed_by);
                });


              } else if (rows[0].state === "busy"){
                console.log("In a busy state");

                setTimeout(function(){
                      console.log('in busy state redirected after a 2 second pause');
                      var data = req.query;
                      res.redirect('/fresh?user='+data.user+'&id='+data.id);
                      return;
                    }, 2000)

              } else if (rows[0].state === "fresh"){
                console.log("////////////////////////////");
                console.log("In a fresh state");

                // variables to ejs pages
                var followed_by;
                var following;

                connection.query('SELECT count(*) from s_followed_by', function(err, rows, fields) {
                  if (err) throw err;
                  followed_by = rows[0]['count(*)'];

                  connection.query('SELECT count(*) from s_following', function(err, rows, fields) {
                    if (err) throw err;
                    following = rows[0]['count(*)'];
                      console.log('following '+following+' and is followed_by '+followed_by+' instagram users');
                      console.log('Data fetched from database');
                      res.render('./partials/dashboard.ejs',  {
                                                                'state': 'fresh',
                                                                'followed_by': followed_by,
                                                                'following': following
                                                              })
                    return;
                  });
                });

              } else if (rows[0].state === "started"){
                console.log("////////////////////////////");
                console.log("In a started state");

                res.render('./partials/dashboard.ejs',  {
                                          'state': 'started',
                                          'followed_by': 'followed_by',
                                          'following': 'following'
                                        })

              } else if (rows[0].state === "stopping"){
                console.log("////////////////////////////");
                console.log("In a stopping state");

                res.render('./partials/dashboard.ejs',  {
                                          'state': 'stopping',
                                          'followed_by': 'followed_by',
                                          'following': 'following'
                                        })

              } else if (rows[0].state === "stopped"){
                console.log("////////////////////////////");
                console.log("In a stopped state");

                res.render('./partials/dashboard.ejs',  {
                                          'state': 'stopped',
                                          'followed_by': 'followed_by',
                                          'following': 'following'
                                        })

              }
            });

          return;
        }
      });

    } else {
      console.log("access denied");
      res.redirect('/404/');
      return;
    }
    return;
    };

//  FIFTH = trigger to start stop the crawl =====================================
  exports.button              = function(req, res) {
    var original_url  = req.headers.referer,
        url_split     = original_url.split("?"),
        req_query     = JSON.parse('{"' + decodeURI(url_split[1].replace(/&/g, "\",\"").replace(/=/g,"\":\"")) + '"}'); // req_query = { user: 'ig_user_name', id: 'ig_id_number' };

    if (JSON.stringify(req_query).length !== 2 && req_query.user !== undefined && req_query.id !== undefined) {
      console.log("has valid structure");

      // check access rights from database.
      connection.query('SELECT fancrawl_username FROM access_right where fancrawl_instagram_id = '+ req_query.id, function(err, rows, fields) {
        if (err) throw err;

        if (rows[0] === undefined || rows[0].fancrawl_username === undefined || rows[0].fancrawl_username !== req_query.user){
          console.log("User not granted");
          res.redirect('/404/');
          return;

        } else {
          console.log("User granted");

            // check state for particular fancrawl_instagram_id
            connection.query('SELECT state FROM access_right where fancrawl_instagram_id = "'+req_query.id+'"', function(err, rows, fields) {
              if (err) throw err;
              if (rows[0].state === "fresh") {
                console.log('database state is fresh');
                connection.query('UPDATE access_right set state = "started" where fancrawl_instagram_id = "'+req_query.id+'"', function(err, rows, fields) {
                  if (err) throw err;
                    console.log('started');

                    connection.query('SELECT last_following_id FROM access_right where fancrawl_instagram_id = "'+req_query.id+'"', function(err, rows, fields) {
                      if (err) throw err;
                      console.log('Last user added was: ', rows[0].last_following_id);

                      // GO_follow( req_query.id , rows[0].last_following_id, req._remoteAddress );
                      GO_follow( req_query.id , rows[0].last_following_id, process.env.LOCALIP );
                      res.redirect('/fresh?'+url_split[1]);
                    });

                });
                return;

              } else if (rows[0].state === "started") {
                console.log('database state is started');
                connection.query('UPDATE access_right set state = "stopped" where fancrawl_instagram_id = "'+req_query.id+'"', function(err, rows, fields) {
                  if (err) throw err;
                    res.redirect('/fresh?'+url_split[1]);
                });
                return;

              } else if (rows[0].state === "stopping") {
                  console.log('database state is stopping');
                return;

              } else if (rows[0].state === "stopped") {
                console.log('database state is stopped');
                connection.query('UPDATE access_right set state = "started" where fancrawl_instagram_id = "'+req_query.id+'"', function(err, rows, fields) {
                  if (err) throw err;
                    console.log('started');
                    connection.query('SELECT last_following_id FROM access_right where fancrawl_instagram_id = "'+req_query.id+'"', function(err, rows, fields) {
                      if (err) throw err;
                      console.log('Last user added was: ', rows[0].last_following_id);

                      // GO_follow( req_query.id , rows[0].last_following_id, req._remoteAddress);
                      GO_follow( req_query.id , rows[0].last_following_id, '104.131.139.11');
                      res.redirect('/fresh?'+url_split[1]);
                    });
                });
                return;
              }
            });
        }
      });
    } else {
      console.log("User not granted");
      res.redirect('/404/');
      return;
    }

    return;
    };


//  =============================================================================
//  TESTING SECTION SECTIONS
//  =============================================================================

//  XXXX = check for enforce signed header ======================================
  exports.secure              = function(req, res) {
    if (JSON.stringify(req.query).length !== 2 && req.query.user !== undefined && req.query.id !== undefined) {
      console.log("has valid structure");

      // check access rights from database.
      connection.query('SELECT fancrawl_username FROM access_right where fancrawl_instagram_id = '+ req.query.id, function(err, rows, fields) {
        if (err) throw err;

        if (rows[0] === undefined || rows[0].fancrawl_username === undefined || rows[0].fancrawl_username !== req.query.user){
          console.log("User not granted");
          res.redirect('/404/');
          return;

        } else {
          console.log("User granted");

          connection.query('SELECT token from access_right where fancrawl_instagram_id = "'+req.query.id+'"', function(err, rows, fields) {
            if (err) throw err;
            // instagram header secret system
            var hmac = crypto.createHmac('SHA256', process.env.FANCRAWLCLIENTSECRET);
                hmac.setEncoding('hex');
                hmac.write(process.env.LOCALIP);
                hmac.end();
            var hash = hmac.read();

            // Set the headers
            var headers = {
                'X-Insta-Forwarded-For': process.env.LOCALIP+'|'+hash
            }

            // Configure the request
            var options = {
                uri: 'https://api.instagram.com/v1/media/657988443280050001_25025320/likes',
                qs: {'access_token': rows[0].token},
                method: 'POST',
                headers: headers,
                form:{action:'unfollow'}
            }

            request(options, function (error, response, body) {
              if (!error && response.statusCode == 200) {
                console.log("secure body: ", body);
              } else if (error) {
                console.log("secure error: ", error);
              }
            });
          });
        }
      });
    } else {
      console.log("Missing information");
      res.redirect('/404/');
    }
    };

//  XXXX = check for response status ============================================
  exports.relationship        = function(req, res) {

    if (JSON.stringify(req.query).length !== 2 && req.query.user !== undefined && req.query.id !== undefined) {
      console.log("has valid structure");

      // check access rights from database.
      connection.query('SELECT fancrawl_username FROM access_right where fancrawl_instagram_id = '+ req.query.id, function(err, rows, fields) {
        if (err) throw err;

        if (rows[0] === undefined || rows[0].fancrawl_username === undefined || rows[0].fancrawl_username !== req.query.user){
          console.log("User not granted");
          res.redirect('/404/');
          return;

        } else {
          console.log("User granted");

          connection.query('SELECT token from access_right where fancrawl_instagram_id = "'+req.query.id+'"', function(err, rows, fields) {
            if (err) throw err;
            request('https://api.instagram.com/v1/users/1/relationship?access_token='+rows[0].token, function (error, response, body) {
                console.log('Relationship body: ', body);
                console.log('Relationship error: ', error);
            });
          });

        }
      });
    } else {
      console.log("Missing information");
      res.redirect('/404/');
    }
    };