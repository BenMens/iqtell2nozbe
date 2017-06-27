var http = require('http'),
    fs = require('fs'),
    requestPromise = require('request-promise'),
    formBody = require('body/form'),
    jsonBody = require('body/json'),
    Router = require('router'),
    formurlencoded = require('form-urlencoded'),
    queryString = require('query-string'),
    url = require('url'),
    finalhandler = require('finalhandler')
    csv = require("csv");


var router = Router();

var accessToken;
var projects = {}
var tasks = {}
var contexts = {}

router
  .get("/",function (req,res,next) {
    res.writeHead(302, {
      'Location': '/login'
    })
    res.end();
  })
  .get("/login",function (req,res,next) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(fs.readFileSync("login.html"));
  })
  .post("/login",function (req,res,next) {

      formBody(req, res,function(error,data) {

        var email = data.email;
        var password = data.password;

        requestPromise.post("https://api.nozbe.com:3000/oauth/secret/create",{
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

            console.log(secretDataResourceUrl);

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
            console.log("error:" + JSON.stringify(error.error));
          })

      })

  })
  .get("/favicon.ico",function (req,res,next) {
    res.writeHead(200, {'Content-Type': 'image/x-icon'});
    res.end(fs.readFileSync("favicon.ico"));
  })
  .get("/app_registered",function (req,res,next) {
    var location = url.parse(req.url);

    var parsed = queryString.parse(location.search);

    accessToken = parsed.access_token;

    res.write("app_registered: " + JSON.stringify(accessToken));
    res.end();

    readNozbeProjects()
      .then(readNozbeTasks);

  });




var server = http.createServer(function(req, res) {
  router(req, res,finalhandler(req, res));
})

server.listen(8080,'localhost')


function readNozbeProjects() {
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

      console.log(projects);
    });

}

function readNozbeTasks() {
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

      console.log(tasks);

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
  csv.parse(data,{columns:true},function(error,data){
    data.forEach(value => {
  //    if (value['Short Description']=="Patent search") {
        console.log("######################################");

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

        value['Due Date']     = parseDate(value['Due Date']);
        value['Date Created'] = parseDate(value['Date Created']);
        value['Date Updated'] = parseDate(value['Date Updated']);


        console.log(value['Short Description']);
        console.log(value['Links']);
        console.log(value['Due Date']);
        console.log(value['Date Created']);
        console.log(value['Date Updated']);
        console.log(value['Status']);
  //    }

    })
  })
}


//readActions(fs.readFileSync("Actions - Folder Content.csv"));
