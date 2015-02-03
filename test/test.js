var express = require('express');
var bodyParser = require('body-parser');
var request = require('supertest');
var should = require('should');
var assert = require('assert');
var mongoose = require('mongoose');
var Resource = require('../Resource');
var app = express();
var _ = require('lodash');
var async = require('async');

// Use the body parser.
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Create the schema.
var ResourceSchema = new mongoose.Schema({
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
var ResourceModel = mongoose.model('Resource', ResourceSchema);

// Create the REST resource.
Resource(app, '/test', 'resource', ResourceModel).rest();

describe('Connect to MongoDB', function() {
  it('Connect to MongoDB', function (done) {
    mongoose.connect('mongodb://localhost/test', done);
  });
  it('Drop test database', function(done) {
    mongoose.connection.db.dropDatabase(done);
  });
});

describe('Test full CRUD capabilities.', function() {
  var resource = {};
  it('/GET empty list', function(done) {
    request(app).get('/test/resource')
      .expect('Content-Range', '*/0')
      .expect(204)
      .end(function(err, res) {
        done(err);
      });
  });
  it('/POST Create new resource', function(done) {
    request(app)
      .post('/test/resource')
      .send({
        title: "Test1",
        description: "12345678"
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
  it('/GET The new resource.', function(done) {
    request(app)
      .get('/test/resource/' + resource._id)
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
      .put('/test/resource/' + resource._id)
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
  it('/GET The changed resource.', function(done) {
    request(app)
      .get('/test/resource/' + resource._id)
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
    request(app).get('/test/resource')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-0/1')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].title, 'Test2');
        assert.equal(res.body[0].description, resource.description);
        assert.equal(res.body[0]._id, resource._id);
        done(err);
      });
  });
  it('/DELETE the resource', function(done) {
    request(app)
      .delete('/test/resource/' + resource._id)
      .expect(204)
      .end(function(err, res) {
        done(err);
      });
  });
  it('/GET empty list', function(done) {
    request(app).get('/test/resource')
      .expect('Content-Range', '*/0')
      .expect(204)
      .end(function(err, res) {
        done(err);
      });
  });
});

describe('Test search capabilities', function() {
  it('Create a full index of resources', function(done) {
    var age = 0;
    async.whilst(
      function() { return age < 25; },
      function(cb) {
        request(app)
          .post('/test/resource')
          .send({
            title: "Test Age " + age,
            description: "Description of test age " + age,
            age: age
          })
          .end(function(err, res) {
            console.log('Creating resource: Test Age ' + age);
            resource = res.body;
            assert.equal(resource.title, 'Test Age ' + age);
            assert.equal(resource.description, 'Description of test age ' + age);
            assert.equal(resource.age, age);
            age++;
            cb(err);
          });
      },
      done
    );
  });

  it('Should limit 10', function(done) {
    request(app).get('/test/resource')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-9/25')
      .expect(206)
      .end(function(err, res) {
        assert.equal(res.body.length, 10);
        var age = 0;
        _.each(res.body, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done(err);
      });
  });

  it('Should accept a change in limit', function(done) {
    request(app).get('/test/resource?limit=5')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-4/25')
      .expect(206)
      .end(function(err, res) {
        assert.equal(res.body.length, 5);
        var age = 0;
        _.each(res.body, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done(err);
      });
  });

  it('Should be able to skip and limit', function(done) {
    request(app).get('/test/resource?limit=5&skip=4')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '4-8/25')
      .expect(206)
      .end(function(err, res) {
        assert.equal(res.body.length, 5);
        var age = 4;
        _.each(res.body, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, 'Description of test age ' + age);
          assert.equal(resource.age, age);
          age++;
        });
        done(err);
      });
  });

  it('Should be able to select fields', function(done) {
    request(app).get('/test/resource?limit=10&skip=10&select=title,age')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '10-19/25')
      .expect(206)
      .end(function(err, res) {
        assert.equal(res.body.length, 10);
        var age = 10;
        _.each(res.body, function(resource) {
          assert.equal(resource.title, 'Test Age ' + age);
          assert.equal(resource.description, undefined);
          assert.equal(resource.age, age);
          age++;
        });
        done(err);
      });
  });

  it('Should be able to sort', function(done) {
    request(app).get('/test/resource?select=age&sort=-age')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-9/25')
      .expect(206)
      .end(function(err, res) {
        assert.equal(res.body.length, 10);
        var age = 24;
        _.each(res.body, function(resource) {
          assert.equal(resource.title, undefined);
          assert.equal(resource.description, undefined);
          assert.equal(resource.age, age);
          age--;
        });
        done(err);
      });
  });

  it('Should paginate with a sort', function(done) {
    request(app).get('/test/resource?limit=5&skip=5&select=age&sort=-age')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '5-9/25')
      .expect(206)
      .end(function(err, res) {
        assert.equal(res.body.length, 5);
        var age = 19;
        _.each(res.body, function(resource) {
          assert.equal(resource.title, undefined);
          assert.equal(resource.description, undefined);
          assert.equal(resource.age, age);
          age--;
        });
        done(err);
      });
  });

  it('Should be able to find', function(done) {
    request(app).get('/test/resource?limit=5&select=age&age=5')
      .expect('Content-Type', /json/)
      .expect('Content-Range', '0-0/1')
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].title, undefined);
        assert.equal(res.body[0].description, undefined);
        assert.equal(res.body[0].age, 5);
        done(err);
      });
  });

  it('$lt selector', function(done) {
    request(app).get('/test/resource?age__lt=5')
      .expect('Content-Range', '0-4/5')
      .end(function(err, res) {
        assert.equal(res.body.length, 5);
        _.each(res.body, function(resource) {
          assert.ok(resource.age < 5);
        });
        done(err);
      });
  });

  it('$lte selector', function(done) {
    request(app).get('/test/resource?age__lte=5')
      .expect('Content-Range', '0-5/6')
      .end(function(err, res) {
        assert.equal(res.body.length, 6);
        _.each(res.body, function(resource) {
          assert.ok(resource.age <= 5);
        });
        done(err);
      });
  });

  it('$gt selector', function(done) {
    request(app).get('/test/resource?age__gt=5')
      .expect('Content-Range', '0-9/19')
      .end(function(err, res) {
        assert.equal(res.body.length, 10);
        _.each(res.body, function(resource) {
          assert.ok(resource.age > 5);
        });
        done(err);
      });
  });

  it('$gte selector', function(done) {
    request(app).get('/test/resource?age__gte=5')
      .expect('Content-Range', '0-9/20')
      .end(function(err, res) {
        assert.equal(res.body.length, 10);
        _.each(res.body, function(resource) {
          assert.ok(resource.age >= 5);
        });
        done(err);
      });
  });

  it('regex selector', function(done) {
    request(app).get('/test/resource?title__regex=/.*Age [0-1]?[0-3]$/g')
      .expect('Content-Range', '0-7/8')
      .end(function(err, res) {
        var valid = [0, 1, 2, 3, 10, 11, 12, 13];
        assert.equal(res.body.length, valid.length);
        _.each(res.body, function(resource) {
          assert.ok(valid.indexOf(resource.age) !== -1);
        });
        done(err);
      });
  });
});


