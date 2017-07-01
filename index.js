var http = require('express'),
    fs = require('fs'),
    requestPromise = require('request-promise'),
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
    upload = multer({ dest: 'uploads/' }),
    md = require('html-md'),
    marked = require('marked'),
    bodyParser = require('body-parser'),
    dateFormat = require('dateformat');

var importStatus = {}

var sessionStore = new FileStore({});

var NOZBE = 1;
var IQTELL = 2;

function Project() {
  this.name='';
  this.nozbeId=undefined;
  this.nozbeProject=undefined;
  this.iqtellProject=undefined;
  this.tasks=[];
  this.fields = {}


  this.setField = function(name,value,source) {
    var field = this.fields[name] = (this.fields[name] || {})
    field.value = value;
    field.source = source;
  }


  this.analyse = function() {
    if (this.nozbeProject) {
      this.source = NOZBE;
      this.setField("name",this.nozbeProject.name,NOZBE);
    }
    else if (this.iqtellProject) {
      this.source = IQTELL;
      this.setField("name",this.iqtellProject["Short Description"],IQTELL);
    }
  }
}

function Task() {
  this.name='';
  this.nozbeId=undefined;
  this.nozbeTask=undefined;
  this.iqtellTask=undefined;
  this.fields = {}
  this.comments = []

  this.setField = function(name,value,source) {
    var field = this.fields[name] = (this.fields[name] || {})
    field.value = value;
    field.source = source;
  }

  this.setComments = function(comments,source) {
    comments.forEach(comment => {
      comment.source = source;
      comment.html = marked(comment.body);
      this.comments.push(comment)
    })
  }

  this.analyse = function() {
    if (this.nozbeTask) {
      this.source = NOZBE;
      this.setField("name",this.nozbeTask.name,NOZBE);
      this.setField("time",this.nozbeTask.time,NOZBE);
      this.setField("next",this.nozbeTask.next,NOZBE);
      this.setField("completed",this.nozbeTask.completed,NOZBE);
      this.setField("datetime",this.nozbeTask.datetime,NOZBE);
      this.setField("recur",this.nozbeTask.recur,NOZBE);
      this.setField("con_list",this.nozbeTask.con_list,NOZBE);
      this.setComments(this.nozbeTask.comments,NOZBE);
    }
    else if (this.iqtellTask) {
      this.source = IQTELL;
      this.setField("name",this.iqtellTask["Short Description"],IQTELL);
      this.setField("time",0,IQTELL);
      this.setField("next",this.iqtellTask["Star"]!="No",IQTELL);
      this.setField("completed",this.iqtellTask["Status"]!="Open",IQTELL);
      this.setField("datetime",this.iqtellTask["Due Date"],IQTELL);
      this.setField("recur",0,IQTELL);
      this.setField("con_list",[],IQTELL);
      // this.setField("comments",[],IQTELL);
    }
  }
}


app.use(session({
  store: sessionStore,
  secret: 'nwjcrhwehrithew',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

var iqtellUpload = upload.fields([{name: 'actions', maxCount: 1 }, { name: 'projects', maxCount: 1 }])

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
  .post("/login",bodyParser.urlencoded({ extended: false }),function (req,res,next) {

    var email = req.body.email;
    var password = req.body.password;

    req.session.accessToken = undefined;

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
  })
  //############################################################################
  //# /app_registered (get)
  //############################################################################
  .get("/app_registered",function (req,res,next) {
    var location = url.parse(req.url);

    var parsed = queryString.parse(location.search);

    var sess = req.session
    sess.accessToken = parsed.access_token;

    createTask(sess.accessToken,{
      name:"test task",
      con_list:["context1","context2"]
    })

    res.writeHead(302, {
      'Location': 'app/upload'
    })
    res.end();
  })
  //############################################################################
  //# /upload (post)
  //############################################################################
  .post("/upload",iqtellUpload,function (req,res,next) {

    var sessId = req.session.id;

    importStatus[sessId] = {
      iqtellProgress : {
        done:false,
        importActions : {},
        importProjects : {}
      }
    }

    Promise.all(
        [readActions(req.files['actions'][0].path,importStatus[sessId].iqtellProgress.importActions),
        readProjects(req.files['projects'][0].path,importStatus[sessId].iqtellProgress.importProjects),
        readNozbeTasks(req.session.accessToken),
        readNozbeProjects(req.session.accessToken),
        readNozbeContexts(req.session.accessToken)])
      .then(function(res) {

        importStatus[sessId].iqtellTasks = res[0];
        importStatus[sessId].iqtellProjects = res[1];
        importStatus[sessId].nozbeTasks = res[2];
        importStatus[sessId].nozbeProjects = res[3];

        console.log(res[4])

        // console.log(res[2])
        // console.log("##############################")
        // console.log(res[3])

        var projects = importStatus[sessId].projects = []
        var contexts = res[4]

        console.log("Step 1")
        importStatus[sessId].nozbeProjects.forEach(function(project) {
          var p  = new Project();
          projects.push(p);

          p.name=project.name;
          p.nozbeId=project.id;
          p.nozbeProject=project;

          importStatus[sessId].nozbeTasks.forEach(function(task) {
            if (task.project_id == p.nozbeId) {
              var t = new Task();
              p.tasks.push(t);

              t.name=task.name;
              t.nozbeId=task.id;
              t.nozbeTask=task;
            }
          })
        })


        console.log("Step 2")
        importStatus[sessId].iqtellProjects.forEach(function(project) {
          var projectName = project["Short Description"];

          var p = projects.find(function(elm) {
            return elm.name == projectName
          })

          if (!p) {
            p = new Project();
            projects.push(p);
            p.name = projectName;
          }

          p.iqtellProject = project;
        })

        console.log("Step 3")
        importStatus[sessId].iqtellTasks.forEach(function(task) {
          var projectName = task.project;

          var p = projects.find(function(elm) {
            return elm.name == projectName
          })

          if (!p) {
            p = new Project();
            projects.push(p);
            p.name = projectName;
          }

          var taskName = task["Short Description"];

          var t=p.tasks.find(function(elm) {
            return elm.name==taskName
          });

          if (!t) {
            t = new Task();
            p.tasks.push(t);
            t.name = taskName;
          }

          t.iqtellTask = task;
        })

        console.log("Step 4")
        projects.forEach(function(project) {
          project.analyse();
          project.tasks.forEach(function(task) {
            task.analyse();
          })
        })


        importStatus[sessId].projects = projects;
        importStatus[sessId].iqtellProgress.done = true;
      })
      .catch(function(error) {

        importStatus[sessId].iqtellProgress.error = error;
        importStatus[sessId].iqtellProgress.errorStr = error.toString();

        try {
          importStatus[sessId].iqtellProgress.importActions.abort();
        } catch (e){}

        try {
          importStatus[sessId].iqtellProgressimportProjects.abort();
        } catch (e){}

      })

      res.writeHead(302, {
        'Location': 'app/validate'
      })
      res.end();

  })
  //############################################################################
  //# /app/* (get)
  //############################################################################
  .use('/app',express.static('app',{extensions:['html']}))
  .set('view engine', 'pug')
  .set('views', './views')
  .get('/app/validate', function (req, res) {
    if (importStatus[req.session.id].iqtellProgress.error) {
      res.render('error_report', importStatus[req.session.id]);
    }
    else if (importStatus[req.session.id].iqtellProgress.done) {
      res.render('validate', importStatus[req.session.id]);
    }
    else {
      res.render('evaluate_progress', importStatus[req.session.id]);
    }
  })


app.listen(8080)


function readNozbeProjects(accessToken) {
  return requestPromise.get("https://api.nozbe.com:3000/list?" + queryString.stringify({
      type: "project",
      access_token : accessToken
    }))
    .then(function(data) {
      return JSON.parse(data);
    });

}

function readNozbeTasks(accessToken) {
  return requestPromise.get("https://api.nozbe.com:3000/list?" + queryString.stringify({
      type: "task",
      access_token : accessToken
    }))
    .then(function(data) {
      return JSON.parse(data);
    });

}

function readNozbeContexts(accessToken) {
  return requestPromise.get("https://api.nozbe.com:3000/list?" + queryString.stringify({
      type: "context",
      access_token : accessToken
    }))
    .then(function(data) {
      return JSON.parse(data);
    });

}

function createProject(accessToken,data) {
  return requestPromise({
    method: 'POST',
    uri:"https://api.nozbe.com:3000/json/project?" + queryString.stringify({access_token : accessToken}),
    body: data,
    json:true
  })
  .then(function (parsedBody) {
    var id;
    for (key in parsedBody) {
      if (parsedBody[key].is_new2) {
        id=key;
      }
    }
    console.log(id);
  })
}

function createTask(accessToken,data) {
  return readNozbeContexts(accessToken)
    .then(function(contexts){
      console.log(contexts)

      var c = []
      contexts.forEach(function(con){c.push(con.id)})
      data.con_list = c;

      console.log(data)

      return requestPromise({
        method: 'POST',
        uri:"https://api.nozbe.com:3000/json/task?" + queryString.stringify({access_token : accessToken}),
        body: [data],
        json:true
      })
      .then(function (parsedBody) {
        console.log(parsedBody);
        var id;
        for (key in parsedBody) {
          console.log(key);
          if (parsedBody[key].is_new2) {
            id=key;
          }
        }
      })
      .catch(function (err) {
        console.log(err);
      });
    })
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

    var date = new Date(year,month-1,day,hour,minute);

    return dateFormat(date,"yyyy-mm-dd H:MM:ss");
  }

  return undefined
}

function readActions(file,progress) {

  var finished = false;
  var stream = fs.createReadStream(file);

  progress.numRead = 0;
  progress.done = false;
  progress.error = undefined
  progress.abort = function() {
    stream.destroy();
  }

  return new Promise(function (resolve, reject) {
    var result = [];

    stream
      .pipe(csv.parse({columns:true,max_limit_on_data_read:256000}))
      .on('error',function(error) {
        stream.emit('error',error);
      })
      .pipe(csv.transform(function(value) {
        result.push(value);

        progress.numRead++;

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
          value.project = 'inbox';
        }

        value['Due Date']     = parseDate(value['Due Date']);
        value['Date Created'] = parseDate(value['Date Created']);
        value['Date Updated'] = parseDate(value['Date Updated']);
        //value['Notes'] = md(value['Notes'],{inline:true});
      }))
      .on('error',function(error) {
        stream.emit('error',error);
      })
      .on('finish',function() {
        if (finished) return;
        finished = true;

        progress.done = true;
        fs.unlink(file,function(){});

        resolve(result);
      })

    stream
      .on('error',function(error) {
        if (finished) return;
        finished = true;

        progress.error = error;
        fs.unlink(file,function(error) {});

        reject(error);
      });
  })
}

function readProjects(file,progress) {
  var finished = false;
  var stream = fs.createReadStream(file);

  progress.numRead = 0;
  progress.done = false;
  progress.error = undefined;
  progress.abort = function() {
    stream.destroy();
  }

  return new Promise(function (resolve, reject) {
    var result = []

    stream
      .pipe(csv.parse({columns:true,max_limit_on_data_read:256000}))
      .on('error',function(error) {
        stream.emit('error',error);
      })
      .pipe(csv.transform(function(value) {
        result.push(value)

        progress.numRead++;

        value['Notes'] = md(value['Notes'],{inline:true});
        value['Brainstorm'] = md(value['Brainstorm'],{inline:true});
        value.tasks = []
      }))
      .on('error',function(error) {
        stream.emit('error',error);
      })
      .on('finish',function() {
        if (finished) return;
        finished = true;

        progress.done = true;
        fs.unlink(file,function(){});

        resolve(result);
      })

    stream
      .on('error',function(error) {
        if (finished) return;
        finished = true;

        progress.error = error;
        fs.unlink(file,function(){});

        reject(error);
      });
   });
}
