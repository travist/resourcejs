var express = require('express');
var bodyParser = require('body-parser');
var request = require('supertest');
var should = require('should');
var assert = require('assert');
var mongoose = require('mongoose');
var Resource = require('../Resource');
var app = express();

// Use the body parser.
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Create the schema.
var ResourceSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
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
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.length, 0);
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
        assert.equal(res.body.title, 'Test1');
        assert.equal(res.body.description, '12345678');
        assert(res.body.hasOwnProperty('_id'), 'Resource ID not found');
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
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function(err, res) {
        assert.equal(res.body.length, 0);
        done(err);
      });
  });
});


