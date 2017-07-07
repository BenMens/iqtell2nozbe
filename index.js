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
    marked = require('marked'),
    bodyParser = require('body-parser'),
    dateFormat = require('dateformat'),
    shortID = require('short-id-gen'),
    jsdiff = require('diff'),
    _toMarkdown = require('to-markdown');

function toMarkdown(s) {
  var converter1 = {
    filter: ["tr","div"],
    replacement: function(content,node) {
      return content + "\n";
    }
  }
  var converter2 = {
    filter: ["table","td","tbody","span","col","colgroup"],
    replacement: function(content,node) {
      return content;
    }
  }
  return _toMarkdown(s,{ converters:[converter1,converter2]});
}

var importStatus = {}

var sessionStore = new FileStore({});

var NOZBE = 1;
var IQTELL = 2;

function compareNotes(n1,n2) {
  if (!n1 || !n2) {
    return false;
  }

  var diff = jsdiff.diffWords(n1,n2);
  var hasDiffs = false;
  diff.forEach(function(d) {
    if (d.added || d.removed) {
      hasDiffs = true;
    }
  });

  return !hasDiffs;
}

function Project(nozbeProject) {
  this.tasks=[];
  this.fields = {};
  this.comments = [];

  this.setField = function(name,value,source) {
    if (!this.fields[name] || (this.fields[name].value != value)) {
      var field = this.fields[name] = (this.fields[name] || {})
      field.value = value;
      field.source = source;
    }
  }

  this.mergeIqtellProject = function(iqtellProject) {
    if (iqtellProject) {
      this.setComment({type:"note",body:toMarkdown(iqtellProject["Notes"])},IQTELL,"IQTell notes");
      this.setComment({type:"note",body:toMarkdown(iqtellProject["Brainstorming Notes"])},IQTELL,"IQTell brainstorming notes");
    }
  }

  this.setComment = function(comment,source,signature) {
    if (!comment.body) return

    var foundComment = this.comments.find(function(c) {
      if (c.data.id == comment.id) {
        return true;
      }
      if (signature && c.data.name==signature) {
        return true;
      }
    });
    if (!foundComment) {

      var newComment = {
        data:comment,
        source:source
      };

      if (!newComment.data.id) {
        newComment.data.id = shortID.generate(16);
        newComment.data.is_new=true;
      }
      if (signature) {
        newComment.data.name = signature;
      }
      this.comments.push(newComment);
    }
    else if (signature) {
      foundComment.source = source;
      foundComment.data.name = signature;
    }
  }


  if (nozbeProject) {
    this.setField("id",nozbeProject.id,NOZBE);
    this.setField("name",nozbeProject.name,NOZBE);
  }

}

function Task(nozbeTask) {

  this.fields = {
    con_list: {
      value:[],
      source:NOZBE
    }
  };
  this.comments = [];

  this.setField = function(name,value,source) {
    if (!this.fields[name] || (this.fields[name].value != value)) {
      var field = this.fields[name] = (this.fields[name] || {})
      field.value = value;
      field.source = source;
    }
  }

  this.setComment = function(comment,source,signature) {
    if (!comment.body) return

    var foundComment = this.comments.find(function(c) {
      if (c.data.id == comment.id) {
        return true;
      }
      if (signature && c.data.body.indexOf(signature)==0) {
        return true;
      }
    });
    if (!foundComment) {

      var newComment = {
        data:comment,
        source:source
      };

      if (!newComment.data.id) {
        newComment.data.id = shortID.generate(16);
        newComment.data.is_new=true;
      }
      if (signature) {
        newComment.data.body = signature + "\n\n" + newComment.data.body
      }
      this.comments.push(newComment);
    }
    else if (signature) {
      foundComment.source = source;
      foundComment.data.body = signature + "\n\n" + comment.body;
    }
  }

  this.setIqtellContext = function(contextId) {
    if (!this.fields.con_list.value.find(function(c) {return c==contextId})) {
      this.fields.con_list.value.push(contextId);
      this.fields.con_list.source = IQTELL;
    }
  }

  this.mergeIqtellTask = function(iqtellTask) {
    if (iqtellTask) {
      this.setField("time",0,IQTELL);
      this.setField("next",iqtellTask["Star"]!="No",IQTELL);
      this.setField("completed",iqtellTask["Status"]!="Open",IQTELL);
      this.setField("datetime",iqtellTask["Due Date"],IQTELL);
      this.setField("recur",0,IQTELL);
      this.setComment({body:toMarkdown(iqtellTask["Notes"])},IQTELL,"IQTell notes:");
    }
  }

  if (nozbeTask) {
    this.setField("id",       nozbeTask.id        ,NOZBE);
    this.setField("name",     nozbeTask.name      ,NOZBE);
    this.setField("time",     nozbeTask.time      ,NOZBE);
    this.setField("next",     nozbeTask.next      ,NOZBE);
    this.setField("completed",nozbeTask.completed ,NOZBE);
    this.setField("datetime", nozbeTask.datetime  ,NOZBE);
    this.setField("recur",    nozbeTask.recur     ,NOZBE);
    this.setField("con_list", nozbeTask.con_list  ,NOZBE);

    nozbeTask.comments.forEach(comment => {
      this.setComment(comment,NOZBE);
    })
  }

}

function Context() {
  this.data={}
}


function GtdData() {
  this.projects = [];
  this.contexts = [];

  this.processNozbeContext = function(nozbeContext) {
    var c = new Context();
    c.data = {
        id:nozbeContext.id,
        name:nozbeContext.name,
        body:nozbeContext.body,
        icon:nozbeContext.icon
      }

    this.contexts.push(c);
  }

  this.processNozbeProject = function(nozbeProject,nozbeTasks) {
    if (nozbeProject.flag != "deleted") {
      var p  = new Project(nozbeProject);
      this.projects.push(p);

      nozbeTasks.forEach(function(nozbeTask) {
        if (nozbeTask.project_id == p.fields.id.value) {
          var t = new Task(nozbeTask);
          p.tasks.push(t);
        }
      })
    }
  }

  this.processNozbeNote = function(nozbeNote) {
    var p = this.projects.find(function(project) {
      return project.fields.id.value == nozbeNote.project_id
    })

    if (p) {
      p.setComment(nozbeNote,NOZBE);
    }
  }

  this.processIqTellProject = function(iqtellProject) {
    var iqtellProjectName = iqtellProject["Short Description"];

    var p = this.projects.find(function(project) {
      return project.fields.name.value.toUpperCase() == iqtellProjectName.toUpperCase()
    })

    if (!p) {
      p = new Project();
      p.setField("name",iqtellProjectName,IQTELL);
      p.setField("id",shortID.generate(16),IQTELL);
      p.setField("is_new",true,IQTELL);
      this.projects.push(p);
    }

    p.mergeIqtellProject(iqtellProject);
  }

  this.processIqTellTask = function(iqtellTask) {
    var iqtellProjectName = iqtellTask.project;

    var p = this.projects.find(function(project) {
      return project.fields.name.value.toUpperCase() == iqtellProjectName.toUpperCase()
    })

    if (!p) {
      p = new Project();
      this.projects.push(p);

      p.setField("name",iqtellProjectName,IQTELL);
      p.setField("id",shortID.generate(16),IQTELL);
      p.setField("is_new",true,IQTELL);
    }

    var iqtellTaskName = iqtellTask["Short Description"];

    var t=p.tasks.find(function(task) {
      return task.fields.name.value.toUpperCase()==iqtellTaskName.toUpperCase();
    });

    if (!t) {
      t = new Task();
      t.setField("id",shortID.generate(16),IQTELL);
      t.setField("name",iqtellTaskName,IQTELL);
      t.setField("is_new",true,IQTELL);

      p.tasks.push(t);
    }

    t.mergeIqtellTask(iqtellTask);

    var contextName = iqtellTask["Context"];
    if (contextName) {
      t.setIqtellContext(this.contextByName(contextName));
    }
  }

  this.contextByName = function(contextName) {
    var c = this.contexts.find(function(c) {return c.data.name.toUpperCase() == contextName.toUpperCase()});

    if (!c) {
      c = new Context();
      this.contexts.push(c);

      c.data.name = contextName;
      c.data.id = shortID.generate(16);
      c.data.body = "";
      c.data.icon = 48;
      c.data.is_new = true;
    }

    return c.data.id;
  }

  this.getContextUpdates = function() {
    var result = [];

    this.contexts.forEach(function(c) {
      if (c.data.is_new) {
        result.push(c.data);
      }
    });

    return result;
  }

  this.getProjectUpdates = function() {
    var result = [];

    this.projects.forEach(function(p) {
      var pFields = {};
      var update = false;

      for (var name in p.fields) {

        if (p.fields[name].source!=NOZBE) {
          pFields[name] = p.fields[name].value;
          update = true;
        }
      }

      if (update) {
        pFields.id = p.fields.id.value;
        result.push(pFields);
      }

    });

    return result;
  }

  this.getProjectCommentUpdates = function() {
    var result = [];

    this.projects.forEach(function(p) {

      p.comments.forEach(function(c) {
        if (c.source==IQTELL) {
          c.data.project_id = p.fields.id.value;
          result.push(c.data);
        }
      });

    });

    return result;
  }


  this.getTaskUpdates = function() {
    var result = [];

    this.projects.forEach(function(p) {

      p.tasks.forEach(function(t) {
        var tFields = {};
        var comments = [];
        var update = false;

        for (var name in t.fields) {

          if (t.fields[name].source!=NOZBE) {
            tFields[name] = t.fields[name].value;
            update = true;
          }
        }

        t.comments.forEach(function(n) {
          if (n.source==IQTELL) {
            comments.push(n.data);
          }
        })

        if (update || comments.length>0) {
          tFields.id = t.fields.id.value;
          tFields.project_id = p.fields.id.value;
          tFields.comments = comments;
          result.push(tFields);
        }
      });
    });

    return result;
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

    return requestPromise("https://webapp.nozbe.com/sync3/login/app_key-iqtell_import",{
        method: "POST",
        form: {
          email: email,
          password: password
        },
        json: true
      })
      .then(function(data) {
        if (data.key) {
          req.session.accessToken = data.key;

          res.writeHead(302, {
            'Location': 'app/upload'
          })
          res.end();
        }
        else {
          res.contentType("text/html");
          res.write('<html><head><title>error</title></head><body>');
          res.write("Wrong username or password");
          res.write('<br/><form action="/"><input type="submit" value="Try again" /></form></body></html>');
          res.end();
        }
      })
      .catch(function() {
        res.contentType("text/html");
        res.write('<html><head><title>error</title></head><body>');
        res.write("Something did go wrong.");
        res.write('<br/><form action="/"><input type="submit" value="Try again" /></form></body></html>');
        res.end();
      })
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
        readNozbeContexts(req.session.accessToken),
        readNozbeNotes(req.session.accessToken)])
      .then(function(res) {

        var iqtellTasks    = res[0];
        var iqtellProjects = res[1];
        var nozbeTasks     = res[2];
        var nozbeProjects  = res[3];
        var nozbeContexts  = res[4];
        var nozbeNotes     = res[5];

        var gtdData = new GtdData();

        console.log("Step 1: Process nozbe contexts")
        nozbeContexts.forEach(function(nozbeContext) {
          gtdData.processNozbeContext(nozbeContext);
        });

        console.log("Step 2: Process nozbe projects")
        nozbeProjects.forEach(function(nozbeProject) {
          gtdData.processNozbeProject(nozbeProject,nozbeTasks);
        });

        console.log("Step 3: Process project notes")
        nozbeNotes.forEach(function(nozbeNote) {
          gtdData.processNozbeNote(nozbeNote);
        });

        console.log("Step 4: Process IQTell projects")
        iqtellProjects.forEach(function(iqtellProject) {
          gtdData.processIqTellProject(iqtellProject);
        });

        console.log("Step 5: Process IQTell tasks")
        iqtellTasks.forEach(function(iqtellTask) {
          gtdData.processIqTellTask(iqtellTask);
        });


        updateNozbe(req.session.accessToken,{
          context:gtdData.getContextUpdates()
        });

        updateNozbe(req.session.accessToken,{
          project:gtdData.getProjectUpdates()
        });

        updateNozbe(req.session.accessToken,{
          task:gtdData.getTaskUpdates()
        });

        updateNozbe(req.session.accessToken,{
          note:gtdData.getProjectCommentUpdates()
        });

        importStatus[sessId].gtdData = gtdData;
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


var port = process.env.PORT || 8080;
app.listen(port);



function readNozbeProjects(accessToken) {
  return requestPromise({
      method: "GET",
      url: "https://webapp.nozbe.com/sync3/getdata/app_key-iqtell_import/what-project",
      headers: {
        "X-Authorization" : accessToken
      },
      json: true
    })
    .then(function(data) {
      return data.project;
    });
}

function readNozbeTasks(accessToken) {
  return requestPromise({
      method: "GET",
      url: "https://webapp.nozbe.com/sync3/getdata/app_key-iqtell_import/what-task",
      headers: {
        "X-Authorization" : accessToken
      },
      json: true
    })
    .then(function(data) {
      return data.task;
    });
}

function readNozbeContexts(accessToken) {
  return requestPromise({
      method: "GET",
      url: "https://webapp.nozbe.com/sync3/getdata/app_key-iqtell_import/what-context",
      headers: {
        "X-Authorization" : accessToken
      },
      json: true
    })
    .then(function(data) {
      return data.context;
    });
}

function readNozbeNotes(accessToken) {
  return requestPromise({
      method: "GET",
      url: "https://webapp.nozbe.com/sync3/getdata/app_key-iqtell_import/what-note",
      headers: {
        "X-Authorization" : accessToken
      },
      json: true
    })
    .then(function(data) {
      return data.note;
    });
}

function updateNozbe(accessToken,data) {
  return requestPromise({
    method: 'POST',
    uri:"https://webapp.nozbe.com/sync3/process/app_key-iqtell_import",
    headers: {
      "X-Authorization" : accessToken,
      "Content-Type":     "application/json"
    },
    body: data,
    json:true
  })
  .then(function (data) {
    // console.log(data)
    return data
  })
  .catch(function(e) {
    //console.log(e)
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

    return dateFormat(date,"yyyy-mm-dd HH:MM:ss");
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
          value.project = 'Inbox';
        }

        value['Due Date']     = parseDate(value['Due Date']);
        value['Date Created'] = parseDate(value['Date Created']);
        value['Date Updated'] = parseDate(value['Date Updated']);
        value['Short Description'] = value['Short Description'].replace(/[#!]/ig,"")
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

        value['Short Description'] = value['Short Description'].replace(/[#!]/ig,"")

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
