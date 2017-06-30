var http = require('express'),
    fs = require('fs'),
    requestPromise = require('request-promise'),
    formBody = require('body/form'),
    jsonBody = require('body/json'),
    formurlencoded = require('form-urlencoded'),
    queryString = require('query-string'),
    url = require('url'),
    finalhandler = require('finalhandler')
    csv = require("csv"),
    express = require('express'),
    app = express(),
    session = require('express-session'),
    FileStore = require('session-file-store')(session),
    multer  = require('multer'),
    upload = multer({ }),
    md = require('html-md'),
    marked = require('marked');



var projects = {}
var tasks = {}
var contexts = {}

app.use(session({
  store: new FileStore({}),
  secret: 'nwjcrhwehrithew',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

var iqtellUpload = upload.fields([{ name: 'actions', maxCount: 1 }, { name: 'projects', maxCount: 1 }])

app
  //############################################################################
  //# / (get)
  //############################################################################
  .get("/",function (req,res,next) {
    res.writeHead(302, {
      'Location': 'app/login'
    })
    res.end();
  })
  //############################################################################
  //# /login (post)
  //############################################################################
  .post("/login",iqtellUpload,function (req,res,next) {


    var email = req.body.email;
    var password = req.body.password;

    req.session.views = {
      accessToken : undefined
    }

    Promise.all([readActions(req.files['actions'][0].buffer),readProjects(req.files['projects'][0].buffer)])
      .then(function(res) {
        req.session.views.iqtellTasks = res[0];
        req.session.views.iqtellProjects = res[1];

        req.session.views.iqtellTasks.forEach(function(task) {
          try {
            req.session.views.iqtellProjects[task.project].tasks.push(task);
          }
          catch (e) {
            req.session.views.iqtellProjects["_NoProject_"].tasks.push(task);
          }
        })
      })
      .then(function() {
        return requestPromise.post("https://api.nozbe.com:3000/oauth/secret/create",{
            body: formurlencoded({
              email: email,
              password: password,
              redirect_uri: "http://localhost:8080/app_registered"
            })
          })
          .catch(function(error) {
            if (error.statusCode == 404) {
                var error = JSON.parse(error.error);

                if (error.error == "Client already exists") {
                  // Ingore this error
                  return
                }
            }

            return Promise.reject(error);
          })
          .then(function() {
            // Get the client secret
            var secretDataResourceUrl = "https://api.nozbe.com:3000/oauth/secret/data?" + queryString.stringify({
                email: email,
                password: password
              })

            return requestPromise.get(secretDataResourceUrl)
              .then(function(data) {
                return data;
              })
          })
          .then(function(data) {
            data = JSON.parse(data);

            var secretDataResourceUrl = "https://api.nozbe.com:3000/oauth/secret/data?" + queryString.stringify({
              client_id: data.client_id,
              client_secret: data.client_secret
              })

            return requestPromise.put(secretDataResourceUrl,{
                body: formurlencoded({
                  redirect_uri: "http://localhost:8080/app_registered"
                })
              })
              .then(function() {
                return data;
              })
          })
          .then(function(data) {
            res.writeHead(302, {
              'Location': "https://api.nozbe.com:3000/login?" + queryString.stringify({
                  client_id: data.client_id
                })
            })
            res.end();
          })
          .catch(function(error) {
            res.contentType("text/html");
            res.write('<html><head><title>error</title></head><body>');
            res.write(JSON.stringify(error.error));
            res.write('<br/><form action="/"><input type="submit" value="Try again" /></form></body></html>');
            res.end();
          })
      });
  })
  //############################################################################
  //# /app_registered (get)
  //############################################################################
  .get("/app_registered",function (req,res,next) {
    var location = url.parse(req.url);

    var parsed = queryString.parse(location.search);

    var sess = req.session
    sess.views.accessToken = parsed.access_token;

    // readNozbeProjects(sess.views.accessToken)
    //   .then(function() {
    //       return readNozbeTasks(sess.views.accessToken);
    //   })
    //   .then(function() {
        res.writeHead(302, {
          'Location': 'app/validate'
        })
       res.end();
      // });
  })
  //############################################################################
  //# /web/*
  //############################################################################
  .use('/app',express.static('app',{extensions:['html']}))
  .set('view engine', 'pug')
  .set('views', './views')
  .get('/app/validate', function (req, res) {
    res.render('validate', req.session.views);
  })


app.listen(8080)


function readNozbeProjects(accessToken) {
  return requestPromise.get("https://api.nozbe.com:3000/list?" + queryString.stringify({
      type: "project",
      access_token : accessToken
    }))
    .then(function(data) {
      data = JSON.parse(data);

      data.forEach(value => {
        projects[value.id] = {
          //raw : value,
          id: value.id,
          name : value.name,
          description : value.description
        }
      });

      // console.log(projects);
    });

}

function readNozbeTasks(accessToken) {
  return requestPromise.get("https://api.nozbe.com:3000/list?" + queryString.stringify({
      type: "task",
      access_token : accessToken
    }))
    .then(function(data) {
      data = JSON.parse(data);

      data.forEach(value => {
        tasks[value.id] = {
//          raw : value,
          id: value.id,
          name : value.name,
          project_id : value.project_id,
          completed: value.completed
        }
      });

      // console.log(tasks);

    });

}

function parseDate(dateString) {
  if (dateString) {
    var day,month,year,hour,minute
    dateString.split(" ").forEach((value,index) => {
      if (index==0) {


          value.split("/").forEach((value,index) => {
            switch(index) {
              case 0:
                day = value;
                break;
              case 1:
                month = value;
                break;
              case 2:
                year = value;
                break;
            }
          })


      }
      else if (index==1) {
        value.split(":").forEach((value,index) => {
          switch(index) {
            case 0:
              hour = value;
              break;
            case 1:
              minute = value;
              break;
          }
      })
      }
    })

    return new Date(year,month-1,day,hour,minute);
  }

  return undefined
}

function readActions(data) {

  return new Promise(function (resolve, reject) {
    var result = [];

    csv.parse(data,{columns:true},function(error,data) {
      data.forEach(value => {

          var links = {};

          value['Links'].split(",")
          .map(link  => {
            return link.split(":").map(s => s.trim());
          })
          .forEach(l => {
              var key = l[0];
              var value = l[1];
              if (key!="") {
                if (!links[key]) {
                  links[key] = [];
                }
                links[key].push(value);
              }
          });

          value['Links'] = links;


          try {
            value.project = links['Project'][0];
          }
          catch(e) {
            value.project = '_NoProject_';
          }

          value['Due Date']     = parseDate(value['Due Date']);
          value['Date Created'] = parseDate(value['Date Created']);
          value['Date Updated'] = parseDate(value['Date Updated']);
          value['Notes'] = md(value['Notes'],{inline:true});
          value['NotesHTML'] = marked(value['Notes']);

          result.push(value);
      })
    })
    .on('end',function() {
      resolve(result);
      })
    .on('error',function(error) {
      reject(error);
    });
  })
}

function readProjects(data) {

  return new Promise(function (resolve, reject) {
    var result = {
      "_NoProject_" : {
        tasks:[]
      }
    };

    csv.parse(data,{columns:true,max_limit_on_data_read:256000},function(error,data) {
      if (error) {
        console.log(error);
        reject(error);
      }
      else {
        data.forEach(value => {

            // value['Due Date']     = parseDate(value['Due Date']);
            // value['Date Created'] = parseDate(value['Date Created']);
            // value['Date Updated'] = parseDate(value['Date Updated']);
            // value['Notes'] = md(value['Notes'],{inline:true});
            // value['NotesHTML'] = marked(value['Notes']);

            value['Notes'] = md(value['Notes'],{inline:true});
            value['Brainstorm'] = md(value['Brainstorm'],{inline:true});
            value.tasks = []
            result[value['Short Description']] = value;
        })
      }
    })
    .on('end',function() {
      resolve(result);
      })
    .on('error',function(error) {
      reject(error);
    });
  });
}
