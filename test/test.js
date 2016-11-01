'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var request = require('supertest');
var assert = require('assert');
var mongoose = require('mongoose');
var Resource = require('../Resource');
var app = express();
var _ = require('lodash');
var async = require('async');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var chance = (new require('chance'))();

// Use the body parser.
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// An object to store handler events.
var handlers = {};

// The raw connection to mongo, for consistency checks with mongoose.
var db = null;

/**
 * Updates the reference for the handler invocation using the given sequence and method.
 *
 * @param entity
 *   The entity this handler is associated with.
 * @param sequence
 *   The sequence of invocation: `before` or `after`.
 * @param req
 *   The express request to manipulate.
 */
var setInvoked = function(entity, sequence, req) {
  // Get the url fragments, to determine if this request is a get or index.
  var parts = req.url.split('/');
  parts.shift(); // Remove empty string element.

  var method = req.method.toLowerCase();
  if (method === 'get' && (parts.length % 2 === 0)) {
    method = 'index';
  }

  if (!handlers.hasOwnProperty(entity)) {
    handlers[entity] = {};
  }
  if (!handlers[entity].hasOwnProperty(sequence)) {
    handlers[entity][sequence] = {};
  }

  handlers[entity][sequence][method] = true;
};

/**
 * Determines if the handler for the sequence and method was invoked.
 *
 * @param entity
 *   The entity this handler is associated with.
 * @param sequence
 *   The sequence of invocation: `before` or `after`.
 * @param method
 *   The HTTP method for the invocation: `post`, `get`, `put`, `delete`, or `patch`
 *
 * @return
 *   If the given handler was invoked or not.
 */
var wasInvoked = function(entity, sequence, method) {
  if (
    handlers.hasOwnProperty(entity)
    && handlers[entity].hasOwnProperty(sequence)
    && handlers[entity][sequence].hasOwnProperty(method)
  ) {
    return handlers[entity][sequence][method];
  }
  else {
    return false;
  }
};

describe('Connect to MongoDB', function() {
  it('Connect to MongoDB', function(done) {
    mongoose.connect('mongodb://localhost/test', done);
  });

  it('Drop test database', function(done) {
    mongoose.connection.db.dropDatabase(done);
  });

  it('Should connect MongoDB without mongoose', function(done) {
    MongoClient.connect('mongodb://localhost/test', function(err, connection) {
      if (err) {
        return done(err);
      }

      db = connection;
      done();
    });
  });
});

describe('Build Resources for following tests', function() {
  it('Build the /test/ref endpoints', function(done) {
    // Create the schema.
    var RefSchema = new mongoose.Schema({
      data: String
    }, {collection: 'ref'});

    // Create the model.
    var RefModel = mongoose.model('ref', RefSchema);

    // Create the REST resource and continue.
    Resource(app, '/test', 'ref', RefModel).rest();
    done();
  });

  it('Build the /test/resource1 endpoints', function(done) {
    // Create the schema.
    var R1SubdocumentSchema = new mongoose.Schema({
      label: {
        type: String
      },
      data: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ref'
      }]
    }, {_id: false});

    var Resource1Schema = new mongoose.Schema({
      title: {
        type: String,
        required: true
      },
      name: {
        type: String,
      },
      age: {
        type: Number
      },
      description: {
        type: String
      },
      list: [R1SubdocumentSchema]
    });

    // Create the model.
    var Resource1Model = mongoose.model('resource1', Resource1Schema);

    // Create the REST resource and continue.
    Resource(app, '/test', 'resource1', Resource1Model).rest({
      afterDelete: function(req, res, next) {
        // Check that the delete item is still being returned via resourcejs.
        assert.notEqual(res.resource.item, {});
        assert.notEqual(res.resource.item, []);
        assert.equal(res.resource.status, 204);
        assert.equal(res.statusCode, 200);
        next();
      }
    });
    done();
  });

  it('Build the /test/resource2 endpoints', function(done) {
    // Create the schema.
    var Resource2Schema = new mongoose.Schema({
      title: {
        type: String,
        required: true
      },
      age: {
        type: Number
      },
      description: {
        type: String
      }
    });

    // Create the model.
    var Resource2Model = mongoose.model('resource2', Resource2Schema);

    // Create the REST resource and continue.
    Resource(app, '/test', 'resource2', Resource2Model).rest({
      // Register before/after global handlers.
      before: function(req, res, next) {
        // Store the invoked handler and continue.
        setInvoked('resource2', 'before', req);
        next();
      },
      after: function(req, res, next) {
        // Store the invoked handler and continue.
        setInvoked('resource2', 'after', req);
        next();
      }
    });

    done();
  });

  it('Build the /test/resource1/:resource1Id/nested1 endpoints', function(done) {
    // Create the schema.
    var Nested1Schema = new mongoose.Schema({
      resource1: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'resource1',
        index: true,
        required: true
      },
      title: {
        type: String,
        required: true
      },
      age: {
        type: Number
      },
      description: {
        type: String
      }
    });

    // Create the model.
    var Nested1Model = mongoose.model('nested1', Nested1Schema);

    // Create the REST resource and continue.
    Resource(app, '/test/resource1/:resource1Id', 'nested1', Nested1Model).rest({
      // Register before global handlers to set the resource1 variable.
      before: function(req, res, next) {
        req.body.resource1 = req.params.resource1Id;
        next();
      }
    });

    done();
  });

  it('Build the /test/resource2/:resource2Id/nested2 endpoints', function(done) {
    // Create the schema.
    var Nested2Schema = new mongoose.Schema({
      resource2: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'resource2',
        index: true,
        required: true
      },
      title: {
        type: String,
        required: true
      },
      age: {
        type: Number
      },
      description: {
        type: String
      }
    });

    // Create the model.
    var Nested2Model = mongoose.model('nested2', Nested2Schema);

    // Create the REST resource and continue.
    Resource(app, '/test/resource2/:resource2Id', 'nested2', Nested2Model).rest({
      // Register before/after global handlers.
      before: function(req, res, next) {
        req.body.resource2 = req.params.resource2Id;
        req.modelQuery = this.model.where('resource2', req.params.resource2Id);

        // Store the invoked handler and continue.
        setInvoked('nested2', 'before', req);
        next();
      },
      after: function(req, res, next) {
        // Store the invoked handler and continue.
        setInvoked('nested2', 'after', req);
        next();
      }
    });

    done();
  });
});

describe('Test single resource CRUD capabilities', function() {
  var resource = {};

  it('/GET empty list', function(done) {
    request(app)
      .get('/test/resource1')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '*/0')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.hasOwnProperty('body'), true);
        assert.deepEqual(res.body, []);
        done(err);
      });
  });

  it('/POST Create new resource', function(done) {
    request(app)
      .post('/test/resource1')
      .send({
        title: 'Test1',
        description: '12345678'
      })
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        resource = res.body;
        assert.equal(resource.title, 'Test1');
        assert.equal(resource.description, '12345678');
        assert(resource.hasOwnProperty('_id'), 'Resource ID not found');
        done(err);
      });
  });

  it('/GET The new resource', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.title, resource.title);
        assert.equal(res.body.description, resource.description);
        assert.equal(res.body._id, resource._id);
        done(err);
      });
  });

  it('/PUT Change data on the resource', function(done) {
    request(app)
      .put('/test/resource1/' + resource._id)
      .send({
        title: 'Test2'
      })
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.title, 'Test2');
        assert.equal(res.body.description, resource.description);
        assert.equal(res.body._id, resource._id);
        resource = res.body;
        done(err);
      });
  });

  it('/PATCH Change data on the resource', function(done) {
    request(app)
      .patch('/test/resource1/' + resource._id)
      .send([{ 'op': 'replace', 'path': '/title', 'value': 'Test3' }])
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.title, 'Test3');
        resource = res.body;
        done(err);
      });
  });

  it('/PATCH Reject update due to failed test op', function(done) {
    request(app)
      .patch('/test/resource1/' + resource._id)
      .send([
        { 'op': 'test', 'path': '/title', 'value': 'not-the-title' },
        { 'op': 'replace', 'path': '/title', 'value': 'Test4' }
      ])
      .expect('Content-Type', /json/)
      .expect(412)
      .end(function(err, res) {
        assert.equal(res.body.title, 'Test3');
        resource = res.body;
        done(err);
      });
  });

  it('/GET The changed resource', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.title, resource.title);
        assert.equal(res.body.description, resource.description);
        assert.equal(res.body._id, resource._id);
        done(err);
      });
  });

  it('/GET index of resources', function(done) {
    request(app)
      .get('/test/resource1')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-0/1')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].title, 'Test3');
        assert.equal(res.body[0].description, resource.description);
        assert.equal(res.body[0]._id, resource._id);
        done(err);
      });
  });

  it('Cannot /POST to an existing resource', function(done) {
    request(app)
      .post('/test/resource1/' + resource._id)
      .expect('Content-Type', /text\/html/)
      .expect(404)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.text;
        var expected = 'Cannot POST /test/resource1/' + resource._id + '\n';
        assert.deepEqual(response, expected);
        done();
      });
  });

  it('/DELETE the resource', function(done) {
    request(app)
      .delete('/test/resource1/' + resource._id)
      .expect(200)
      .end(function(err, res) {
        assert.deepEqual(res.body, {});
        done(err);
      });
  });

  it('/GET empty list', function(done) {
    request(app)
      .get('/test/resource1')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '*/0')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.hasOwnProperty('body'), true);
        assert.deepEqual(res.body, []);
        done(err);
      });
  });

  describe('Test single resource subdocument updates', function() {
    // Ensure that resource reference is empty.
    resource = {};
    var doc1 = null;
    var doc2 = null;

    describe('Bootstrap', function() {
      it('Should create a reference doc with mongoose', function(done) {
        var doc = {data: 'test1'};

        request(app)
          .post('/test/ref')
          .send(doc)
          .expect('Content-Type', /json/)
          .expect(201)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var response = _.omit(res.body, '__v');
            assert.equal(response.data, doc.data);
            doc1 = response;
            done();
          });
      });

      it('Should be able to create a reference doc directly with mongo', function(done) {
        var doc = {data: 'test2'};
        var compare = _.clone(doc);

        var ref = db.collection('ref');
        ref.insertOne(doc, function(err, result) {
          if (err) {
            return done(err);
          }

          var response = result.ops[0];
          assert.deepEqual(_.omit(response, '_id'), compare);
          response._id = response._id.toString();
          doc2 = response;
          done();
        });
      });

      it('Should be able to directly create a resource with subdocuments using mongo', function(done) {
        // Set the resource collection for direct mongo queries.
        var resource1 = db.collection('resource1');

        var tmp = {
          title: 'Test2',
          description: '987654321',
          list: [
            {label: 'one', data: [doc1._id]}
          ]
        };
        var compare = _.clone(tmp);

        resource1.insertOne(tmp, function(err, result) {
          if (err) {
            return done(err);
          }

          resource = result.ops[0];
          assert.deepEqual(_.omit(resource, '_id'), compare);
          done();
        });
      });
    });

    describe('Subdocument Tests', function() {
      it('/PUT to a resource with subdocuments should not mangle the subdocuments', function(done) {
        var two = {label: 'two', data: [doc2._id]};

        request(app)
          .put('/test/resource1/' + resource._id)
          .send({list: resource.list.concat(two)})
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var response = res.body;
            assert.equal(response.title, resource.title);
            assert.equal(response.description, resource.description);
            assert.equal(response._id, resource._id);
            assert.deepEqual(response.list, resource.list.concat(two));
            resource = response;
            done();
          });
      });

      it('Manual DB updates to a resource with subdocuments should not mangle the subdocuments', function(done) {
        var updates = [
          {label: '1', data: [doc1._id]},
          {label: '2', data: [doc2._id]},
          {label: '3', data: [doc1._id, doc2._id]}
        ];

        var resource1 = db.collection('resource1');
        resource1.findOneAndUpdate(
          {_id: ObjectID(resource._id)},
          {$set: {list: updates}},
          {returnOriginal: false},
          function(err, doc) {
            if (err) {
              return done(err);
            }

            var response = doc.value;
            assert.equal(response.title, resource.title);
            assert.equal(response.description, resource.description);
            assert.equal(response._id, resource._id);
            assert.deepEqual(response.list, updates);
            resource = response;
            done();
          });
      });

      it('/PUT to a resource subdocument should not mangle the subdocuments', function(done) {
        // Update a subdocument property.
        var update = _.clone(resource.list);
        request(app)
          .put('/test/resource1/' + resource._id)
          .send({list: update})
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var response = res.body;
            assert.equal(response.title, resource.title);
            assert.equal(response.description, resource.description);
            assert.equal(response._id, resource._id);
            assert.deepEqual(response.list, update);
            resource = response;
            done();
          });
      });

      it('/PUT to a top-level property should not mangle the other collection properties', function(done) {
        var tempTitle = 'an update without docs';

        request(app)
          .put('/test/resource1/' + resource._id)
          .send({title: tempTitle})
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var response = res.body;
            assert.equal(response.title, tempTitle);
            assert.equal(response.description, resource.description);
            assert.equal(response._id, resource._id);
            assert.deepEqual(response.list, resource.list);
            resource = response;
            done();
          });
      });
    });

    // Remove the test resource.
    describe('Subdocument cleanup', function() {
      it('Should remove the test resource', function(done) {
        var resource1 = db.collection('resource1');
        resource1.findOneAndDelete({_id: ObjectID(resource._id)});
        done();
      });

      it('Should remove the test ref resources', function(done) {
        var ref = db.collection('ref');
        ref.findOneAndDelete({_id: ObjectID(doc1._id)});
        ref.findOneAndDelete({_id: ObjectID(doc2._id)});
        done();
      });
    });
  });
});

describe('Test single resource search capabilities', function() {
  var refDoc1Content = null;
  var refDoc1Response = null;

  it('Should create a reference doc with mongoose', function(done) {
    refDoc1Content = {data: 'test1'};

    request(app)
      .post('/test/ref')
      .send(refDoc1Content)
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = _.omit(res.body, '__v');
        assert.equal(response.data, refDoc1Content.data);
        refDoc1Response = response;
        done();
      });
  });

  var names = [];
  it('Create a full index of resources', function(done) {
    var age = 0;

    async.whilst(
      function() { return age < 25; },
      function(cb) {
        var name = (chance.name()).toUpperCase();
        names.push(name);

        request(app)
          .post('/test/resource1')
          .send({
            title: 'Test Age ' + age,
            name: name,
            description: 'Description of test age ' + age,
            age: age
          })
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var response = res.body;
            assert.equal(response.title, 'Test Age ' + age);
            assert.equal(response.description, 'Description of test age ' + age);
            assert.equal(response.age, age);
            age++;
            cb();
          });
      },
      function (err) {
        if (err) {
          return done(err);
        }

        // List with a ref resource
        var refList = [ { label: '1', data: [refDoc1Response._id] } ];

        // Insert a record with no age.
        request(app)
          .post('/test/resource1')
          .send({
            title: 'No Age',
            name: 'noage',
            description: 'No age',
            list: refList
          })
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var response = res.body;
            assert.equal(response.title, 'No Age');
            assert.equal(response.description, 'No age');
            assert.equal(response.name, 'noage');
            assert(!response.hasOwnProperty('age'), 'Age should not be found.');
            done();
          });
      }
    );
  });

  it('Should populate', function(done) {
    request(app)
      .get('/test/resource1?name=noage&populate=list.data')
      .send()
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;

        // Chec statusCode
        assert.equal(res.statusCode, 200);

        // Check main resource
        assert.equal(response[0].title, 'No Age');
        assert.equal(response[0].description, 'No age');
        assert.equal(response[0].name, 'noage');
        assert.equal(response[0].list.length, 1);

        // Check populated resource
        assert.equal(response[0].list[0].label, '1');
        assert.equal(response[0].list[0].data.length, 1);
        assert.equal(response[0].list[0].data[0]._id, refDoc1Response._id);
        assert.equal(response[0].list[0].data[0].data, refDoc1Content.data);
        done();
      });
  });

  it('Should ignore empty populate query parameter', function(done) {
    request(app)
      .get('/test/resource1?name=noage&populate=')
      .send()
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;

        // Chec statusCode
        assert.equal(res.statusCode, 200);

        // Check main resource
        assert.equal(response[0].title, 'No Age');
        assert.equal(response[0].description, 'No age');
        assert.equal(response[0].name, 'noage');
        assert.equal(response[0].list.length, 1);

        // Check populated resource
        assert.equal(response[0].list[0].label, '1');
        assert.equal(response[0].list[0].data.length, 1);
        assert.equal(response[0].list[0].data[0], refDoc1Response._id);
        done();
      });
  });

  it('Should not populate paths that are not a reference', function(done) {
    request(app)
      .get('/test/resource1?name=noage&populate=list')
      .send()
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;

        // Chec statusCode
        assert.equal(res.statusCode, 500);

        // Check error
        assert.equal(response.message.indexOf('Cannot populate'), 0);
        done();
      });
  });

  it('Should limit 10', function(done) {
    request(app)
      .get('/test/resource1')
      .expect('Content-Type', /json/)
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        var age = 0;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should accept a change in limit', function(done) {
    request(app)
      .get('/test/resource1?limit=5')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-4/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 5);
        var age = 0;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should be able to skip and limit', function(done) {
    request(app)
      .get('/test/resource1?limit=5&skip=4')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '4-8/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 5);
        var age = 4;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should default negative limit to 10', function(done) {
    request(app)
      .get('/test/resource1?limit=-5&skip=4')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '4-13/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        var age = 4;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should default negative skip to 0', function(done) {
    request(app)
      .get('/test/resource1?limit=5&skip=-4')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-4/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 5);
        var age = 0;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should default negative skip and negative limit to 0 and 10', function(done) {
    request(app)
      .get('/test/resource1?limit=-5&skip=-4')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-9/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        var age = 0;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should default non numeric limit to 10', function(done) {
    request(app)
      .get('/test/resource1?limit=badlimit&skip=4')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '4-13/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        var age = 4;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should default non numeric skip to 0', function(done) {
    request(app)
      .get('/test/resource1?limit=5&skip=badskip')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-4/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 5);
        var age = 0;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should be able to select fields', function(done) {
    request(app)
      .get('/test/resource1?limit=10&skip=10&select=title,age')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '10-19/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        var age = 10;
        _.each(response, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, undefined);
          assert.equal(resource.age, age);
          age++;
        });
        done();
      });
  });

  it('Should be able to sort', function(done) {
    request(app)
      .get('/test/resource1?select=age&sort=-age')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-9/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        var age = 24;
        _.each(response, function(resource) {
          assert.equal(resource.title, undefined);
          assert.equal(resource.description, undefined);
          assert.equal(resource.age, age);
          age--;
        });
        done();
      });
  });

  it('Should paginate with a sort', function(done) {
    request(app)
      .get('/test/resource1?limit=5&skip=5&select=age&sort=-age')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '5-9/26')
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 5);
        var age = 19;
        _.each(response, function(resource) {
          assert.equal(resource.title, undefined);
          assert.equal(resource.description, undefined);
          assert.equal(resource.age, age);
          age--;
        });
        done();
      });
  });

  it('Should be able to find', function(done) {
    request(app)
      .get('/test/resource1?limit=5&select=age&age=5')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-0/1')
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        assert.equal(response[0].title, undefined);
        assert.equal(response[0].description, undefined);
        assert.equal(response[0].age, 5);
        done();
      });
  });

  it('eq search selector', function(done) {
    request(app)
      .get('/test/resource1?age__eq=5')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        _.each(response, function(resource) {
          assert.equal(resource.age, 5);
        });
        done();
      });
  });

  it('equals (alternative) search selector', function(done) {
    request(app)
      .get('/test/resource1?age=5')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        _.each(response, function(resource) {
          assert.equal(resource.age, 5);
        });
        done();
      });
  });

  it('ne search selector', function(done) {
    request(app)
      .get('/test/resource1?age__ne=5&limit=100')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 25);
        _.each(response, function(resource) {
          assert.notEqual(resource.age, 5);
        });
        done();
      });
  });

  it('in search selector', function(done) {
    request(app)
      .get('/test/resource1?age__in=1,5,9,20')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 4);
        _.each(response, function(resource) {
          var found = false;

          [1,5,9,20].forEach(function(a) {
            if (resource.age && resource.age === a) {
              found = true;
            }
          });

          assert(found);
        });
        done();
      });
  });

  it('nin search selector', function(done) {
    request(app)
      .get('/test/resource1?age__nin=1,5')
      .expect('Content-Type', /json/)
      .expect(206)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        _.each(response, function(resource) {
          var found = false;

          [1,5].forEach(function(a) {
            if (resource.age && resource.age === a) {
              found = true;
            }
          });

          assert(!found);
        });
        done();
      });
  });

  it('exists=false search selector', function(done) {
    request(app)
      .get('/test/resource1?age__exists=false')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        assert.equal(response[0].name, 'noage');
        done();
      });
  });

  it('exists=0 search selector', function(done) {
    request(app)
      .get('/test/resource1?age__exists=0')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        assert.equal(response[0].name, 'noage');
        done();
      });
  });

  it('exists=true search selector', function(done) {
    request(app)
      .get('/test/resource1?age__exists=true&limit=1000')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 25);
        _.each(response, function(resource) {
          assert(resource.name !== 'noage', 'No age should be found.');
        });
        done();
      });
  });

  it('exists=1 search selector', function(done) {
    request(app)
      .get('/test/resource1?age__exists=true&limit=1000')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 25);
        _.each(response, function(resource) {
          assert(resource.name !== 'noage', 'No age should be found.');
        });
        done();
      });
  });

  it('lt search selector', function(done) {
    request(app)
      .get('/test/resource1?age__lt=5')
      .expect('Content-Range', '0-4/5')
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 5);
        _.each(response, function(resource) {
          assert.ok(resource.age < 5);
        });
        done();
      });
  });

  it('lte search selector', function(done) {
    request(app)
      .get('/test/resource1?age__lte=5')
      .expect('Content-Range', '0-5/6')
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 6);
        _.each(response, function(resource) {
          assert.ok(resource.age <= 5);
        });
        done();
      });
  });

  it('gt search selector', function(done) {
    request(app)
      .get('/test/resource1?age__gt=5')
      .expect('Content-Range', '0-9/19')
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        _.each(response, function(resource) {
          assert.ok(resource.age > 5);
        });
        done();
      });
  });

  it('gte search selector', function(done) {
    request(app)
      .get('/test/resource1?age__gte=5')
      .expect('Content-Range', '0-9/20')
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 10);
        _.each(response, function(resource) {
          assert.ok(resource.age >= 5);
        });
        done();
      });
  });

  it('regex search selector', function(done) {
    request(app)
      .get('/test/resource1?title__regex=/.*Age [0-1]?[0-3]$/g')
      .expect('Content-Range', '0-7/8')
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        var valid = [0, 1, 2, 3, 10, 11, 12, 13];
        assert.equal(response.length, valid.length);
        _.each(response, function(resource) {
          assert.ok(valid.indexOf(resource.age) !== -1);
        });
        done();
      });
  });

  it('regex search selector should be case insensitive', function(done) {
    var name = names[0].toString();

    request(app)
      .get('/test/resource1?name__regex=' + name.toUpperCase())
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var uppercaseResponse = res.body;
        request(app)
          .get('/test/resource1?name__regex=' + name.toLowerCase())
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var lowercaseResponse = res.body;
            assert.equal(uppercaseResponse.length, lowercaseResponse.length);
            done();
          });
      });
  });
});

describe('Test single resource handlers capabilities', function() {
  // Store the resource being mutated.
  var resource = {};

  it('A POST request should invoke the global handlers', function(done) {
    request(app)
      .post('/test/resource2')
      .send({
        title: 'Test1',
        description: '12345678'
      })
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Test1');
        assert.equal(response.description, '12345678');
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('resource2', 'before', 'post'), true);
        assert.equal(wasInvoked('resource2', 'after', 'post'), true);

        // Store the resource and continue.
        resource = response;
        done();
      });
  });

  it('A GET request should invoke the global handlers', function(done) {
    request(app)
      .get('/test/resource2/' + resource._id)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Test1');
        assert.equal(response.description, '12345678');
        assert(response.hasOwnProperty('_id'), 'Resource ID not found');

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('resource2', 'before', 'get'), true);
        assert.equal(wasInvoked('resource2', 'after', 'get'), true);

        // Store the resource and continue.
        resource = response;
        done();
      });
  });

  it('A PUT request should invoke the global handlers', function(done) {
    request(app)
      .put('/test/resource2/' + resource._id)
      .send({
        title: 'Test1 - Updated'
      })
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Test1 - Updated');
        assert.equal(response.description, '12345678');
        assert(response.hasOwnProperty('_id'), 'Resource ID not found');

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('resource2', 'before', 'put'), true);
        assert.equal(wasInvoked('resource2', 'after', 'put'), true);

        // Store the resource and continue.
        resource = response;
        done();
      });
  });

  it('A GET (Index) request should invoke the global handlers', function(done) {
    request(app)
      .get('/test/resource2')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        assert.equal(response[0].title, 'Test1 - Updated');
        assert.equal(response[0].description, '12345678');
        assert(response[0].hasOwnProperty('_id'), 'Resource ID not found');

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('resource2', 'before', 'index'), true);
        assert.equal(wasInvoked('resource2', 'after', 'index'), true);

        // Store the resource and continue.
        resource = response[0];
        done();
      });
  });

  it('A DELETE request should invoke the global handlers', function(done) {
    request(app)
      .delete('/test/resource2/' + resource._id)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.deepEqual(response, {});

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('resource2', 'before', 'delete'), true);
        assert.equal(wasInvoked('resource2', 'after', 'delete'), true);

        // Store the resource and continue.
        resource = response;
        done();
      });
  });
});

describe('Test nested resource CRUD capabilities', function() {
  var resource = {};
  var nested = {};

  it('/POST a new parent resource', function(done) {
    request(app)
      .post('/test/resource1')
      .send({
        title: 'Test1',
        description: '123456789'
      })
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Test1');
        assert.equal(response.description, '123456789');
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        resource = response;
        done();
      });
  });

  it('/GET an empty list of nested resources', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id + '/nested1')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '*/0')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.hasOwnProperty('body'), true);
        assert.deepEqual(res.body, []);
        done();
      });
  });

  it('/POST a new nested resource', function(done) {
    request(app)
      .post('/test/resource1/' + resource._id + '/nested1')
      .send({
        title: 'Nest1',
        description: '987654321'
      })
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Nest1');
        assert.equal(response.description, '987654321');
        assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource1, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        nested = response;
        done();
      });
  });

  it('/GET the list of nested resources', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, nested.title);
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource1, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);
        done();
      });
  });

  it('/PUT the nested resource', function(done) {
    request(app)
      .put('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .send({
        title: 'Nest1 - Updated1'
      })
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Nest1 - Updated1');
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource1, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);
        nested = response;
        done();
      });
  });

  it('/PATCH data on the nested resource', function(done) {
    request(app)
      .patch('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .send([{ 'op': 'replace', 'path': '/title', 'value': 'Nest1 - Updated2' }])
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Nest1 - Updated2');
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource1, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);
        nested = response;
        done();
      });
  });

  it('/PATCH rejection on the nested resource due to failed test op', function(done) {
    request(app)
      .patch('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .send([
        { 'op': 'test', 'path': '/title', 'value': 'not-the-title' },
        { 'op': 'replace', 'path': '/title', 'value': 'Nest1 - Updated3' }
      ])
      .expect('Content-Type', /json/)
      .expect(412)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, nested.title);
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource1, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);
        done();
      });
  });

  it('/GET the nested resource with patch changes', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, nested.title);
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource1, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);
        done();
      });
  });

  it('/GET index of nested resources', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id + '/nested1')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        assert.equal(response[0].title, nested.title);
        assert.equal(response[0].description, nested.description);
        assert(response[0].hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
        assert.equal(response[0].resource1, resource._id);
        assert(response[0].hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response[0]._id, nested._id);
        done();
      });
  });

  it('Cannot /POST to an existing nested resource', function(done) {
    request(app)
      .post('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .expect('Content-Type', /text\/html/)
      .expect(404)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.text;
        var expected = 'Cannot POST /test/resource1/' + resource._id + '/nested1/' + nested._id + '\n';
        assert.deepEqual(response, expected);
        done();
      });
  });

  it('/DELETE the nested resource', function(done) {
    request(app)
      .delete('/test/resource1/' + resource._id + '/nested1/' + nested._id)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.deepEqual(response, {});
        done();
      });
  });

  it('/GET an empty list of nested resources', function(done) {
    request(app)
      .get('/test/resource1/' + resource._id + '/nested1/')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '*/0')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.hasOwnProperty('body'), true);
        assert.deepEqual(res.body, []);
        done();
      });
  });
});

describe('Test nested resource handlers capabilities', function() {
  // Store the resources being mutated.
  var resource = {};
  var nested = {};

  it('/POST a new parent resource', function(done) {
    request(app)
      .post('/test/resource2')
      .send({
        title: 'Test2',
        description: '987654321'
      })
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Test2');
        assert.equal(response.description, '987654321');
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        resource = response;
        done();
      });
  });

  it('Reset the history of the global handlers', function(done) {
    handlers = {};
    done();
  });

  it('A POST request to a child resource should invoke the global handlers', function(done) {
    request(app)
      .post('/test/resource2/' + resource._id + '/nested2')
      .send({
        title: 'Nest2',
        description: '987654321'
      })
      .expect('Content-Type', /json/)
      .expect(201)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Nest2');
        assert.equal(response.description, '987654321');
        assert(response.hasOwnProperty('resource2'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource2, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('nested2', 'before', 'post'), true);
        assert.equal(wasInvoked('nested2', 'after', 'post'), true);

        // Store the resource and continue.
        nested = response;
        done();
      });
  });

  it('A GET request to a child resource should invoke the global handlers', function(done) {
    request(app)
      .get('/test/resource2/' + resource._id + '/nested2/' + nested._id)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, nested.title);
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource2'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource2, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('nested2', 'before', 'get'), true);
        assert.equal(wasInvoked('nested2', 'after', 'get'), true);
        done();
      });
  });

  it('A PUT request to a child resource should invoke the global handlers', function(done) {
    request(app)
      .put('/test/resource2/' + resource._id + '/nested2/' + nested._id)
      .send({
        title: 'Nest2 - Updated'
      })
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.title, 'Nest2 - Updated');
        assert.equal(response.description, nested.description);
        assert(response.hasOwnProperty('resource2'), 'The response must contain the parent object `_id`');
        assert.equal(response.resource2, resource._id);
        assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response._id, nested._id);

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('nested2', 'before', 'put'), true);
        assert.equal(wasInvoked('nested2', 'after', 'put'), true);

        // Store the resource and continue.
        nested = response;
        done();
      });
  });

  it('A GET (Index) request to a child resource should invoke the global handlers', function(done) {
    request(app)
      .get('/test/resource2/' + resource._id + '/nested2')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.equal(response.length, 1);
        assert.equal(response[0].title, nested.title);
        assert.equal(response[0].description, nested.description);
        assert(response[0].hasOwnProperty('resource2'), 'The response must contain the parent object `_id`');
        assert.equal(response[0].resource2, resource._id);
        assert(response[0].hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
        assert.equal(response[0]._id, nested._id);

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('nested2', 'before', 'index'), true);
        assert.equal(wasInvoked('nested2', 'after', 'index'), true);
        done();
      });
  });

  it('A DELETE request to a child resource should invoke the global handlers', function(done) {
    request(app)
      .delete('/test/resource2/' + resource._id + '/nested2/' + nested._id)
      .expect(200)
      .end(function(err, res) {
        if (err) {
          return done(err);
        }

        var response = res.body;
        assert.deepEqual(response, {});

        // Confirm that the handlers were called.
        assert.equal(wasInvoked('nested2', 'before', 'delete'), true);
        assert.equal(wasInvoked('nested2', 'after', 'delete'), true);

        // Store the resource and continue.
        resource = response;
        done();
      });
  });
});
