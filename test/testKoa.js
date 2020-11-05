/* eslint-disable no-prototype-builtins */
'use strict';

const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const request = require('supertest');
const assert = require('assert');
const moment = require('moment');
const mongoose = require('mongoose');
const Resource = require('../KoaResource');
const app = new Koa();
const server = app.listen();
const _ = require('lodash');
const MongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectID;
const chance = (new require('chance'))();

const baseTestDate = moment.utc('2018-04-12T12:00:00.000Z');
const testDates = [
    baseTestDate,                               // actual
    moment(baseTestDate).subtract(1, 'day'),    // oneDayAgo
    moment(baseTestDate).subtract(1, 'month'),  // oneMonthAgo
    moment(baseTestDate).subtract(1, 'year'),   // oneYearAgo
];

// Use the body parser.
app.use(bodyParser());

// An object to store handler events.
let handlers = {};

// The raw connection to mongo, for consistency checks with mongoose.
let db = null;

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
function setInvoked(entity, sequence, ctx) {
    // Get the url fragments, to determine if this request is a get or index.
    const parts = ctx.url.split('/');
    parts.shift(); // Remove empty string element.

    let method = ctx.method.toLowerCase();
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
}

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
function wasInvoked(entity, sequence, method) {
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
}

describe('Connect to MongoDB', () => {
    it('Connect to MongoDB', async() => {
        const connection = await mongoose.connect('mongodb://localhost:27017/test', {
            useCreateIndex: true,
            useUnifiedTopology: true,
            useNewUrlParser: true,
        });
        assert.ok(connection);
    });

    it('Drop test database', async() => {
        const result = await mongoose.connection.db.dropDatabase();
        assert.ok(result);
    });

    it('Should connect MongoDB without mongoose', () => MongoClient.connect('mongodb://localhost:27017', {
        useCreateIndex: true,
        useUnifiedTopology: true,
        useNewUrlParser: true,
    })
        .then((client) => db = client.db('test')));
});

describe('Build Resources for following tests', () => {
    it('Build the /test/ref endpoints', () => {
        // Create the schema.
        const RefSchema = new mongoose.Schema({
            data: String,
        }, { collection: 'ref' });

        // Create the model.
        const RefModel = mongoose.model('ref', RefSchema);

        // Create the REST resource and continue.
        const test = Resource(app, '/test', 'ref', RefModel).rest();
        const testSwaggerio = require('./snippets/testSwaggerio.json');
        const swaggerio = test.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.ref);
        assert.equal(swaggerio.definitions.ref.title, 'ref');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, testSwaggerio);
    });

    it('Build the /test/resource1 endpoints', () => {
        // Create the schema.
        const R1SubdocumentSchema = new mongoose.Schema({
            label: {
                type: String,
            },
            data: [{
                type: mongoose.Schema.Types.ObjectId,
                ref: 'ref',
            }],
        }, { _id: false });

        const Resource1Schema = new mongoose.Schema({
            title: {
                type: String,
                required: true,
            },
            name: {
                type: String,
            },
            age: {
                type: Number,
            },
            description: {
                type: String,
            },
            list: [R1SubdocumentSchema],
            list2: [String],
        });

        // Create the model.
        const Resource1Model = mongoose.model('resource1', Resource1Schema);

        // Create the REST resource and continue.
        const resource1 = Resource(app, '/test', 'resource1', Resource1Model).rest({
            async afterDelete(ctx, next) {
                // Check that the delete item is still being returned via resourcejs.
                assert.notEqual(ctx.state.resource.item, {});
                assert.notEqual(ctx.state.resource.item, []);
                assert.equal(ctx.state.resource.status, 204);
                assert.equal(ctx.status, 404); // In Koa the ctx status is changed in respond
                return await next();
            },
        });
        const resource1Swaggerio = require('./snippets/resource1Swaggerio.json');
        const swaggerio = resource1.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.resource1);
        assert.equal(swaggerio.definitions.resource1.title, 'resource1');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, resource1Swaggerio);
    });

    it('Build the /test/resource2 endpoints', () => {
        // Create the schema.
        const Resource2Schema = new mongoose.Schema({
            title: {
                type: String,
                required: true,
            },
            age: {
                type: Number,
            },
            married: {
                type: Boolean,
                default: false,
            },
            updated: {
                type: Number,
                default: null,
            },
            description: {
                type: String,
            },
        });

        // Create the model.
        const Resource2Model = mongoose.model('resource2', Resource2Schema);

        // Create the REST resource and continue.
        const resource2 = Resource(app, '/test', 'resource2', Resource2Model).rest({
            // Register before/after global handlers.
            async before(ctx, next) {
                // Store the invoked handler and continue.
                setInvoked('resource2', 'before', ctx);
                return await next();
            },
            async beforePost(ctx, next) {
                // Store the invoked handler and continue.
                setInvoked('resource2', 'beforePost', ctx);
                return await next();
            },
            async after(ctx, next) {
                // Store the invoked handler and continue.
                setInvoked('resource2', 'after', ctx);
                return await next();
            },
            async afterPost(ctx, next) {
                // Store the invoked handler and continue.
                setInvoked('resource2', 'afterPost', ctx);
                return await next();
            },
        });
        const resource2Swaggerio = require('./snippets/resource2Swaggerio.json');
        const swaggerio = resource2.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.resource2);
        assert.equal(swaggerio.definitions.resource2.title, 'resource2');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, resource2Swaggerio);
    });

    it('Build the /test/date endpoints and fill it with data', () => {
        const Schema = new mongoose.Schema({
            date: {
                type: Date,
            },
        });

        // Create the model.
        const Model = mongoose.model('date', Schema);

        const date = Resource(app, '/test', 'date', Model).rest();
        const resource3Swaggerio = require('./snippets/dateSwaggerio.json');
        const swaggerio = date.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.date);
        assert.equal(swaggerio.definitions.date.title, 'date');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, resource3Swaggerio);
        return Promise.all(testDates.map((date) => request(server)
            .post('/test/date')
            .send({
                date: date.toDate(),
            })));
    });

    it('Build the /test/resource1/:resource1Id/nested1 endpoints', () => {
        // Create the schema.
        const Nested1Schema = new mongoose.Schema({
            resource1: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'resource1',
                index: true,
                required: true,
            },
            title: {
                type: String,
                required: true,
            },
            age: {
                type: Number,
            },
            description: {
                type: String,
            },
        });

        // Create the model.
        const Nested1Model = mongoose.model('nested1', Nested1Schema);

        // Create the REST resource and continue.
        const nested1 = Resource(app, '/test/resource1/:resource1Id', 'nested1', Nested1Model).rest({
            // Register before global handlers to set the resource1 variable.
            async before(ctx, next) {
                ctx.request.body.resource1 = ctx.params.resource1Id;
                return await next();
            },
        });
        const nested1Swaggerio = require('./snippets/nested1Swaggerio.json');
        const swaggerio = nested1.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.nested1);
        assert.equal(swaggerio.definitions.nested1.title, 'nested1');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, nested1Swaggerio);
    });

    it('Build the /test/resource2/:resource2Id/nested2 endpoints', () => {
        // Create the schema.
        const Nested2Schema = new mongoose.Schema({
            resource2: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'resource2',
                index: true,
                required: true,
            },
            title: {
                type: String,
                required: true,
            },
            age: {
                type: Number,
            },
            description: {
                type: String,
            },
        });

        // Create the model.
        const Nested2Model = mongoose.model('nested2', Nested2Schema);

        // Create the REST resource and continue.
        const nested2 = Resource(app, '/test/resource2/:resource2Id', 'nested2', Nested2Model).rest({
            // Register before/after global handlers.
            async before(ctx, next) {
                ctx.request.body.resource2 = ctx.params.resource2Id;
                ctx.state.modelQuery = this.model.where('resource2', ctx.params.resource2Id);

                // Store the invoked handler and continue.
                setInvoked('nested2', 'before', ctx);
                return await next();
            },
            async after(ctx, next) {
                // Store the invoked handler and continue.
                setInvoked('nested2', 'after', ctx);
                return await next();
            },
        });
        const nested2Swaggerio = require('./snippets/nested2Swaggerio.json');
        const swaggerio = nested2.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.nested2);
        assert.equal(swaggerio.definitions.nested2.title, 'nested2');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, nested2Swaggerio);
    });

    it('Build the /test/resource3 endpoints', () => {
        // Create the schema.
        const Resource3Schema = new mongoose.Schema({
            title: String,
            writeOption: String,
        });

        Resource3Schema.pre('save', function(next, options) {
            if (options && options.writeSetting) {
                return next();
            }

            next(new Error('Save options not passed to middleware'));
        });

        Resource3Schema.pre('remove', function(next, options) {
            if (options && options.writeSetting) {
                return next();
            }

            return next(new Error('DeleteOptions not passed to middleware'));
        });

        // Create the model.
        const Resource3Model = mongoose.model('resource3', Resource3Schema);

        // Create the REST resource and continue.
        const resource3 = Resource(app, '/test', 'resource3', Resource3Model).rest({
            async before(ctx, next) {
                // This setting should be passed down to the underlying `save()` command
                ctx.state.writeOptions = { writeSetting: true };

                return await next();
            },
        });
        const resource3Swaggerio = require('./snippets/resource3Swaggerio.json');
        const swaggerio = resource3.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.resource3);
        assert.equal(swaggerio.definitions.resource3.title, 'resource3');
        assert.equal(Object.values(swaggerio.paths).length, 2);
        assert.deepEqual(swaggerio, resource3Swaggerio);
    });

    it('Build the /test/resource4 endpoints', () => {
        // Create the schema.
        const Resource4Schema = new mongoose.Schema({
            title: String,
            writeOption: String,
        });

        // Create the model.
        const Resource4Model = mongoose.model('resource4', Resource4Schema);

        const doc = new Resource4Model({ title: 'Foo' });
        doc.save();

        // Create the REST resource and continue.
        const resource4 = Resource(app, '/test', 'resource4', Resource4Model)
            .rest({
                async beforePatch(ctx, next) {
                    ctx.state.modelQuery = {
                        findOne: async function findOne() {
                            throw new Error('failed');
                        },
                    };
                    return await next();
                },
            })
            .virtual({
                path: 'undefined_query',
                before: async function(ctx, next) {
                    ctx.state.modelQuery = undefined;
                    return await next();
                },
            })
            .virtual({
                path: 'defined',
                before: async function(ctx, next) {
                    ctx.state.modelQuery = Resource4Model.aggregate([
                        { $group: { _id: null, titles: { $sum: '$title' } } },
                    ]);
                    return await next();
                },
            })
            .virtual({
                path: 'error',
                before: async function(ctx, next) {
                    ctx.state.modelQuery = {
                        exec: async function exec() {
                            throw new Error('Failed');
                        },
                    };
                    return await next();
                },
            })
            .virtual({
                path: 'empty',
                before: async function(ctx, next) {
                    ctx.state.modelQuery = {
                        exec: async function exec() {
                            return;
                        },
                    };
                    return await next();
                },
            });
        const resource4Swaggerio = require('./snippets/resource4Swaggerio.json');
        const swaggerio = resource4.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.resource4);
        assert.equal(swaggerio.definitions.resource4.title, 'resource4');
        assert.equal(Object.values(swaggerio.paths).length, 6);
        assert.deepEqual(swaggerio, resource4Swaggerio);
    });

    it('Build the /test/skip endpoints', () => {
        // Create the schema.
        const SkipSchema = new mongoose.Schema({
            title: String,
        });

        // Create the model.
        const SkipModel = mongoose.model('skip', SkipSchema);

        // Create the REST resource and continue.
        const skipResource = Resource(app, '/test', 'skip', SkipModel)
            .rest({
                before: async(ctx, next) => {
                    ctx.state.skipResource = true;
                    return await next();
                },
            })
            .virtual({
                path: 'resource',
                before: async(ctx, next) => {
                    ctx.state.skipResource = true;
                    return await next();
                },
            });
        const skipSwaggerio = require('./snippets/skipSwaggerio.json');
        const swaggerio = skipResource.swagger();
        assert.equal(Object.values(swaggerio).length, 2);
        assert.ok(swaggerio.definitions);
        assert.ok(swaggerio.definitions.skip);
        assert.equal(swaggerio.definitions.skip.title, 'skip');
        assert.equal(Object.values(swaggerio.paths).length, 3);
        assert.deepEqual(swaggerio, skipSwaggerio);
    });
});

describe('Test skipResource', () => {
    const resource = {};
    it('/GET empty list', () => request(server)
        .get('/test/skip')
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/POST Create new resource', () => request(server)
        .post('/test/skip')
        .send({
            title: 'Test1',
            description: '12345678',
        })
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/GET The new resource', () => request(server)
        .get(`/test/skip/${resource._id}`)
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/PUT Change data on the resource', () => request(server)
        .put(`/test/skip/${resource._id}`)
        .send({
            title: 'Test2',
        })
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/PATCH Change data on the resource', () => request(server)
        .patch(`/test/skip/${resource._id}`)
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/DELETE the resource', () => request(server)
        .delete(`/test/skip/${resource._id}`)
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/VIRTUAL the resource', () => request(server)
        .get('/test/skip/virtual/resource')
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));
});

describe('Test Virtual resource and Patch errors', () => {
    it('/VIRTUAL undefined resource query', () => request(server)
        .get('/test/resource4/virtual/undefined_query')
        .expect('Content-Type', /json/)
        .expect(404)
        .then((res) => {
            assert.equal(res.body.errors[0], 'Resource not found');
        }));

    it('/VIRTUAL resource query', () => request(server)
        .get('/test/resource4/virtual/defined')
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response[0]._id, null);
            assert.equal(response[0].titles, 0);
        }));

    it('/VIRTUAL errorous resource query', () => request(server)
        .get('/test/resource4/virtual/error')
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            const response = res.body;
            assert.equal(response.message, 'Failed');
        }));

    it('/VIRTUAL empty resource response', () => request(server)
        .get('/test/resource4/virtual/empty')
        .expect('Content-Type', /json/)
        .expect(404)
        .then((res) => {
            const response = res.body;
            assert.equal(response.errors[0], 'Resource not found');
        }));

    it('/PATCH with errorous modelquery', () => request(server)
        .patch('/test/resource4/1234')
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            const response = res.body;
            assert.equal(response.message, 'failed');
        }));
});

describe('Test single resource CRUD capabilities', () => {
    let resource = {};

    it('/GET empty list', () => request(server)
        .get('/test/resource1')
        .expect('Content-Type', /json/)
        .expect('Content-Range', '*/0')
        .expect(200)
        .then((res) => {
            assert.equal(res.hasOwnProperty('body'), true);
            assert.deepEqual(res.body, []);
        }));

    it('/POST Create new resource', () => request(server)
        .post('/test/resource1')
        .send({
            title: 'Test1',
            description: '12345678',
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            resource = res.body;
            assert.equal(resource.title, 'Test1');
            assert.equal(resource.description, '12345678');
            assert(resource.hasOwnProperty('_id'), 'Resource ID not found');
        }));

    it('/GET The new resource', () => request(server)
        .get(`/test/resource1/${resource._id}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            assert.equal(res.body.title, resource.title);
            assert.equal(res.body.description, resource.description);
            assert.equal(res.body._id, resource._id);
        }));

    it('/PUT Change data on the resource', () => request(server)
        .put(`/test/resource1/${resource._id}`)
        .send({
            title: 'Test2',
        })
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            assert.equal(res.body.title, 'Test2');
            assert.equal(res.body.description, resource.description);
            assert.equal(res.body._id, resource._id);
            resource = res.body;
        }));

    it('/PATCH Change data on the resource', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'replace', 'path': '/title', 'value': 'Test3' }])
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            assert.equal(res.body.title, 'Test3');
            resource = res.body;
        }));

    it('/PATCH Reject update due to failed test op', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([
            { 'op': 'test', 'path': '/title', 'value': 'not-the-title' },
            { 'op': 'replace', 'path': '/title', 'value': 'Test4' },
        ])
        .expect('Content-Type', /json/)
        .expect(412)
        .then((res) => {
            assert.equal(res.body.title, 'Test3');
            resource = res.body;
        }));

    it('/PATCH Reject update due to incorrect patch operation', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'does-not-exist', 'path': '/title', 'value': 'Test4' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_OP_INVALID');
        }));

    it('/PATCH Should not care whether patch is array or not', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send({ 'op': 'test', 'path': '/title', 'value': 'Test3' })
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            assert.equal(res.body.title, 'Test3');
        }));

    it('/PATCH Reject update due to incorrect patch object', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send(['invalid-patch'])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_NOT_AN_OBJECT');
        }));

    it('/PATCH Reject update due to incorrect patch value', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'replace', 'path': '/title', 'value': undefined }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_VALUE_REQUIRED');
        }));

    it('/PATCH Reject update due to incorrect patch add path', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'add', 'path': '/path/does/not/exist', 'value': 'Test4' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_PATH_CANNOT_ADD');
        }));

    it('/PATCH Reject update due to incorrect patch path', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'replace', 'path': '/path/does/not/exist', 'value': 'Test4' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_PATH_UNRESOLVABLE');
        }));

    it('/PATCH Reject update due to incorrect patch path', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'replace', 'path': 1, 'value': 'Test4' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_PATH_INVALID');
        }));

    it('/PATCH Reject update due to incorrect patch path', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'add', 'path': '/path/does/not/exist', 'value': 'Test4' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_PATH_CANNOT_ADD');
        }));

    it('/PATCH Reject update due to incorrect patch path', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'move', 'from': '/path/does/not/exist', 'path': '/path/does/not/exist', 'value': 'Test4' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_FROM_UNRESOLVABLE');
        }));

    it('/PATCH Reject update due to incorrect patch array', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'add', 'path': '/list/invalidindex', 'value': '2' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX');
        }));

    it('/PATCH Reject update due to incorrect patch array', () => request(server)
        .patch(`/test/resource1/${resource._id}`)
        .send([{ 'op': 'add', 'path': '/list/9999', 'value': '2' }])
        .expect('Content-Type', /json/)
        .expect(400)
        .then((res) => {
            assert.equal(res.body.errors[0].name, 'OPERATION_VALUE_OUT_OF_BOUNDS');
        }));

    it('/GET The changed resource', () => request(server)
        .get(`/test/resource1/${resource._id}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            assert.equal(res.body.title, resource.title);
            assert.equal(res.body.description, resource.description);
            assert.equal(res.body._id, resource._id);
        }));

    it('/GET index of resources', () => request(server)
        .get('/test/resource1')
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-0/1')
        .expect(200)
        .then((res) => {
            assert.equal(res.body.length, 1);
            assert.equal(res.body[0].title, 'Test3');
            assert.equal(res.body[0].description, resource.description);
            assert.equal(res.body[0]._id, resource._id);
        }));

    it('Cannot /POST to an existing resource', () => request(server)
        .post(`/test/resource1/${resource._id}`)
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/DELETE the resource', () => request(server)
        .delete(`/test/resource1/${resource._id}`)
        .expect(200)
        .then((res) => {
            assert.deepEqual(res.body, {});
        }));

    it('/GET empty list', () => request(server)
        .get('/test/resource1')
        .expect('Content-Type', /json/)
        .expect('Content-Range', '*/0')
        .expect(200)
        .then((res) => {
            assert.equal(res.hasOwnProperty('body'), true);
            assert.deepEqual(res.body, []);
        }));

    describe('Test single resource subdocument updates', () => {
        // Ensure that resource reference is empty.
        resource = {};
        let doc1 = null;
        let doc2 = null;

        describe('Bootstrap', () => {
            it('Should create a reference doc with mongoose', () => {
                const doc = { data: 'test1' };

                return request(server)
                    .post('/test/ref')
                    .send(doc)
                    .expect('Content-Type', /json/)
                    .expect(201)
                    .then((res) => {
                        const response = _.omit(res.body, '__v');
                        assert.equal(response.data, doc.data);
                        doc1 = response;
                    });
            });

            it('Should be able to create a reference doc directly with mongo', () => {
                const doc = { data: 'test2' };
                const compare = _.clone(doc);

                const ref = db.collection('ref');
                ref.insertOne(doc, (err, result) => {
                    const response = result.ops[0];
                    assert.deepEqual(_.omit(response, '_id'), compare);
                    response._id = response._id.toString();
                    doc2 = response;
                });
            });

            it('Should be able to directly create a resource with subdocuments using mongo', () => {
                // Set the resource collection for direct mongo queries.
                const resource1 = db.collection('resource1');

                const tmp = {
                    title: 'Test2',
                    description: '987654321',
                    list: [
                        { label: 'one', data: [doc1._id] },
                    ],
                };
                const compare = _.clone(tmp);

                return resource1.insertOne(tmp).then((result) => {
                    resource = result.ops[0];
                    assert.deepEqual(_.omit(resource, '_id'), compare);
                });
            });
        });

        describe('Subdocument Tests', () => {
            it('/PUT to a resource with subdocuments should not mangle the subdocuments', () => {
                const two = { label: 'two', data: [doc2._id] };

                return request(server)
                    .put(`/test/resource1/${resource._id}`)
                    .send({ list: resource.list.concat(two) })
                    .expect('Content-Type', /json/)
                    .expect(200)
                    .then((res) => {
                        const response = res.body;
                        assert.equal(response.title, resource.title);
                        assert.equal(response.description, resource.description);
                        assert.equal(response._id, resource._id);
                        assert.deepEqual(response.list, resource.list.concat(two));
                        resource = response;
                    });
            });

            it('Manual DB updates to a resource with subdocuments should not mangle the subdocuments', () => {
                const updates = [
                    { label: '1', data: [doc1._id] },
                    { label: '2', data: [doc2._id] },
                    { label: '3', data: [doc1._id, doc2._id] },
                ];

                const resource1 = db.collection('resource1');
                resource1.findOneAndUpdate(
                    { _id: ObjectId(resource._id) },
                    { $set: { list: updates } },
                    { returnOriginal: false },
                    (err, doc) => {
                        const response = doc.value;
                        assert.equal(response.title, resource.title);
                        assert.equal(response.description, resource.description);
                        assert.equal(response._id, resource._id);
                        assert.deepEqual(response.list, updates);
                        resource = response;
                    });
            });

            it('/PUT to a resource subdocument should not mangle the subdocuments', () => {
                // Update a subdocument property.
                const update = _.clone(resource.list);
                return request(server)
                    .put(`/test/resource1/${resource._id}`)
                    .send({ list: update })
                    .expect('Content-Type', /json/)
                    .expect(200)
                    .then((res) => {
                        const response = res.body;
                        assert.equal(response.title, resource.title);
                        assert.equal(response.description, resource.description);
                        assert.equal(response._id, resource._id);
                        assert.deepEqual(response.list, update);
                        resource = response;
                    });
            });

            it('/PUT to a top-level property should not mangle the other collection properties', () => {
                const tempTitle = 'an update without docs';

                return request(server)
                    .put(`/test/resource1/${resource._id}`)
                    .send({ title: tempTitle })
                    .expect('Content-Type', /json/)
                    .expect(200)
                    .then((res) => {
                        const response = res.body;
                        assert.equal(response.title, tempTitle);
                        assert.equal(response.description, resource.description);
                        assert.equal(response._id, resource._id);
                        assert.deepEqual(response.list, resource.list);
                        resource = response;
                    });
            });
        });

        // Remove the test resource.
        describe('Subdocument cleanup', () => {
            it('Should remove the test resource', () => {
                const resource1 = db.collection('resource1');
                resource1.findOneAndDelete({ _id: ObjectId(resource._id) });
            });

            it('Should remove the test ref resources', () => {
                const ref = db.collection('ref');
                ref.findOneAndDelete({ _id: ObjectId(doc1._id) });
                ref.findOneAndDelete({ _id: ObjectId(doc2._id) });
            });
        });
    });
});

let refDoc1Content = null;
let refDoc1Response = null;
const resourceNames = [];
// eslint-disable-next-line max-statements
function testSearch(testPath) {
    it('Should populate', () => request(server)
        .get(`${testPath}?name=noage&populate=list.data`)
        .then((res) => {
            const response = res.body;

            // Check statusCode
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
        }));

    it('Should ignore empty populate query parameter', () => request(server)
        .get(`${testPath}?name=noage&populate=`)
        .then((res) => {
            const response = res.body;

            // Check statusCode
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
        }));

    it('Should not populate paths that are not a reference', () => request(server)
        .get(`${testPath}?name=noage&populate=list2`)
        .then((res) => {
            const response = res.body;

            // Check statusCode
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
        }));

    it('Should populate with options', () => request(server)
        .get(`${testPath}?name=noage&populate[path]=list.data`)
        .expect(200)
        .then((res) => {
            const response = res.body;

            // Check statusCode
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
        }));

    it('Should limit 10', () => request(server)
        .get(testPath)
        .expect('Content-Type', /json/)
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 0;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should accept a change in limit', () => request(server)
        .get(`${testPath}?limit=5`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-4/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 5);
            let age = 0;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should be able to skip and limit', () => request(server)
        .get(`${testPath}?limit=5&skip=4`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '4-8/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 5);
            let age = 4;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should default negative limit to 10', () => request(server)
        .get(`${testPath}?limit=-5&skip=4`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '4-13/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 4;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should default negative skip to 0', () => request(server)
        .get(`${testPath}?limit=5&skip=-4`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-4/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 5);
            let age = 0;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should default negative skip and negative limit to 0 and 10', () => request(server)
        .get(`${testPath}?limit=-5&skip=-4`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-9/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 0;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should default non numeric limit to 10', () => request(server)
        .get(`${testPath}?limit=badlimit&skip=4`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '4-13/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 4;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should default non numeric skip to 0', () => request(server)
        .get(`${testPath}?limit=5&skip=badskip`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-4/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 5);
            let age = 0;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, `Description of test age ${age}`);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should be able to select fields', () => request(server)
        .get(`${testPath}?limit=10&skip=10&select=title,age`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '10-19/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 10;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, undefined);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should be able to select fields with multiple select queries', () => request(server)
        .get(`${testPath}?limit=10&skip=10&select=title&select=age`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '10-19/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 10;
            response.forEach((resource) => {
                assert.equal(resource.title, `Test Age ${age}`);
                assert.equal(resource.description, undefined);
                assert.equal(resource.age, age);
                age++;
            });
        }));

    it('Should be able to sort', () => request(server)
        .get(`${testPath}?select=age&sort=-age`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-9/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            let age = 24;
            response.forEach((resource) => {
                assert.equal(resource.title, undefined);
                assert.equal(resource.description, undefined);
                assert.equal(resource.age, age);
                age--;
            });
        }));

    it('Should paginate with a sort', () => request(server)
        .get(`${testPath}?limit=5&skip=5&select=age&sort=-age`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '5-9/26')
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 5);
            let age = 19;
            response.forEach((resource) => {
                assert.equal(resource.title, undefined);
                assert.equal(resource.description, undefined);
                assert.equal(resource.age, age);
                age--;
            });
        }));

    it('Should be able to find', () => request(server)
        .get(`${testPath}?limit=5&select=age&age=5`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '0-0/1')
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, undefined);
            assert.equal(response[0].description, undefined);
            assert.equal(response[0].age, 5);
        }));

    it('eq search selector', () => request(server)
        .get(`${testPath}?age__eq=5`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            response.forEach((resource) => {
                assert.equal(resource.age, 5);
            });
        }));

    it('equals (alternative) search selector', () => request(server)
        .get(`${testPath}?age=5`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            response.forEach((resource) => {
                assert.equal(resource.age, 5);
            });
        }));

    it('ne search selector', () => request(server)
        .get(`${testPath}?age__ne=5&limit=100`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 25);
            response.forEach((resource) => {
                assert.notEqual(resource.age, 5);
            });
        }));

    it('in search selector', () => request(server)
        .get(`${testPath}?title__in=Test Age 1,Test Age 5,Test Age 9,Test Age 20`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 4);
            response.forEach((resource) => {
                let found = false;

                [1, 5, 9, 20].forEach((a) => {
                    if (resource.age && resource.age === a) {
                        found = true;
                    }
                });

                assert(found);
            });
        }));

    it('nin search selector', () => request(server)
        .get(`${testPath}?title__nin=Test Age 1,Test Age 5`)
        .expect('Content-Type', /json/)
        .expect(206)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            response.forEach((resource) => {
                let found = false;

                [1, 5].forEach((a) => {
                    if (resource.age && resource.age === a) {
                        found = true;
                    }
                });

                assert(!found);
            });
        }));

    it('exists=false search selector', () => request(server)
        .get(`${testPath}?age__exists=false`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].name, 'noage');
        }));

    it('exists=0 search selector', () => request(server)
        .get(`${testPath}?age__exists=0`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].name, 'noage');
        }));

    it('exists=true search selector', () => request(server)
        .get(`${testPath}?age__exists=true&limit=1000`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 25);
            response.forEach((resource) => {
                assert(resource.name !== 'noage', 'No age should be found.');
            });
        }));

    it('exists=1 search selector', () => request(server)
        .get(`${testPath}?age__exists=true&limit=1000`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 25);
            response.forEach((resource) => {
                assert(resource.name !== 'noage', 'No age should be found.');
            });
        }));

    it('lt search selector', () => request(server)
        .get(`${testPath}?age__lt=5`)
        .expect('Content-Range', '0-4/5')
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 5);
            response.forEach((resource) => {
                assert.ok(resource.age < 5);
            });
        }));

    it('lte search selector', () => request(server)
        .get(`${testPath}?age__lte=5`)
        .expect('Content-Range', '0-5/6')
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 6);
            response.forEach((resource) => {
                assert.ok(resource.age <= 5);
            });
        }));

    it('gt search selector', () => request(server)
        .get(`${testPath}?age__gt=5`)
        .expect('Content-Range', '0-9/19')
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            response.forEach((resource) => {
                assert.ok(resource.age > 5);
            });
        }));

    it('gte search selector', () => request(server)
        .get(`${testPath}?age__gte=5`)
        .expect('Content-Range', '0-9/20')
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 10);
            response.forEach((resource) => {
                assert.ok(resource.age >= 5);
            });
        }));

    it('regex search selector', () => request(server)
        .get(`${testPath}?title__regex=/.*Age [0-1]?[0-3]$/g`)
        .expect('Content-Range', '0-7/8')
        .then((res) => {
            const response = res.body;
            const valid = [0, 1, 2, 3, 10, 11, 12, 13];
            assert.equal(response.length, valid.length);
            response.forEach((resource) => {
                assert.ok(valid.includes(resource.age));
            });
        }));

    it('regex search selector should be case insensitive', () => {
        const name = resourceNames[0].toString();

        return request(server)
            .get(`${testPath}?name__regex=${name.toUpperCase()}`)
            .then((res) => {
                const uppercaseResponse = res.body;
                return request(server)
                    .get(`/test/resource1?name__regex=${name.toLowerCase()}`)
                    .then((res) => {
                        const lowercaseResponse = res.body;
                        assert.equal(uppercaseResponse.length, lowercaseResponse.length);
                    });
            });
    });
}

describe('Test single resource search capabilities', () => {
    let singleResource1Id = undefined;
    it('Should create a reference doc with mongoose', () => {
        refDoc1Content = { data: 'test1' };
        return request(server)
            .post('/test/ref')
            .send(refDoc1Content)
            .expect('Content-Type', /json/)
            .expect(201)
            .then((res) => {
                const response = _.omit(res.body, '__v');
                assert.equal(response.data, refDoc1Content.data);
                refDoc1Response = response;
            });
    });

    it('Create a full index of resources', () => _.range(25).reduce((promise, age) => {
        const name = (chance.name()).toUpperCase();
        resourceNames.push(name);
        return promise.then(() => request(server)
            .post('/test/resource1')
            .send({
                title: `Test Age ${age}`,
                description: `Description of test age ${age}`,
                name,
                age,
            })
            .then((res) => {
                const response = res.body;
                assert.equal(response.title, `Test Age ${age}`);
                assert.equal(response.description, `Description of test age ${age}`);
                assert.equal(response.age, age);
            }));
    }, Promise.resolve())
        .then(() => {
            const refList = [{ label: '1', data: [refDoc1Response._id] }];

            // Insert a record with no age.
            return request(server)
                .post('/test/resource1')
                .send({
                    title: 'No Age',
                    name: 'noage',
                    description: 'No age',
                    list: refList,
                })
                .then((res) => {
                    const response = res.body;
                    assert.equal(response.title, 'No Age');
                    assert.equal(response.description, 'No age');
                    assert.equal(response.name, 'noage');
                    assert(!response.hasOwnProperty('age'), 'Age should not be found.');

                    singleResource1Id = res.body._id;
                });
        }));

    testSearch('/test/resource1');

    it('Should allow population on single object GET request', () => request(server)
        .get(`/test/resource1/${singleResource1Id}?populate=list.data`)
        .then((res) => {
            const response = res.body;

            // Check statusCode
            assert.equal(res.statusCode, 200);

            // Check main resource
            assert.equal(response.title, 'No Age');
            assert.equal(response.description, 'No age');
            assert.equal(response.name, 'noage');
            assert.equal(response.list.length, 1);

            // Check populated resource
            assert.equal(response.list[0].label, '1');
            assert.equal(response.list[0].data.length, 1);
            assert.equal(response.list[0].data[0]._id, refDoc1Response._id);
            assert.equal(response.list[0].data[0].data, refDoc1Content.data);
        }));

    it('Create an aggregation path', () => {
        Resource(app, '', 'aggregation', mongoose.model('resource1')).rest({
            async beforeIndex(ctx, next) {
                ctx.state.modelQuery = mongoose.model('resource1');
                ctx.state.modelQuery.pipeline = [];
                return await next();
            },
        });
    });

    testSearch('/aggregation');
});

describe('Test dates search capabilities', () => {
    it('Should search by ISO date', () => {
        const isoString = testDates[0].toISOString();

        return Promise.all([
            request(server)
                .get(`/test/date?date=${isoString}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__lt=${isoString}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
            request(server)
                .get(`/test/date?date__lte=${isoString}`)
                .then(({ body: response }) => assert.equal(response.length, 4)),
            request(server)
                .get(`/test/date?date__gte=${isoString}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__gt=${isoString}`)
                .then(({ body: response }) => assert.equal(response.length, 0)),
            request(server)
                .get(`/test/date?date__ne=${isoString}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
        ]);
    });

    it('Should search by YYYY-MM-DD format', () => {
        const search = testDates[0].format('YYYY-MM-DD');

        return Promise.all([
            request(server)
                .get(`/test/date?date=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 0)),
            request(server)
                .get(`/test/date?date__lt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
            request(server)
                .get(`/test/date?date__lte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
            request(server)
                .get(`/test/date?date__gte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__gt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__ne=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 4)),
        ]);
    });

    it('Should search by YYYY-MM format', () => {
        const search = testDates[0].format('YYYY-MM');

        return Promise.all([
            request(server)
                .get(`/test/date?date=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 0)),
            request(server)
                .get(`/test/date?date__lt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 2)),
            request(server)
                .get(`/test/date?date__lte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 2)),
            request(server)
                .get(`/test/date?date__gte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 2)),
            request(server)
                .get(`/test/date?date__gt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 2)),
            request(server)
                .get(`/test/date?date__ne=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 4)),
        ]);
    });

    it('Should search by YYYY format', () => {
        const search = testDates[0].format('YYYY');

        return Promise.all([
            request(server)
                .get(`/test/date?date=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 0)),
            request(server)
                .get(`/test/date?date__lt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__lte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__gte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
            request(server)
                .get(`/test/date?date__gt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
            request(server)
                .get(`/test/date?date__ne=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 4)),
        ]);
    });

    it('Should search by timestamp', () => {
        const search = testDates[0].format('x');

        return Promise.all([
            request(server)
                .get(`/test/date?date=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__lt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
            request(server)
                .get(`/test/date?date__lte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 4)),
            request(server)
                .get(`/test/date?date__gte=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 1)),
            request(server)
                .get(`/test/date?date__gt=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 0)),
            request(server)
                .get(`/test/date?date__ne=${search}`)
                .then(({ body: response }) => assert.equal(response.length, 3)),
        ]);
    });
});

describe('Test single resource handlers capabilities', () => {
    // Store the resource being mutated.
    let resource = {};

    it('A POST request should invoke the global handlers and method handlers', () => request(server)
        .post('/test/resource2')
        .send({
            title: 'Test1',
            description: '12345678',
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1');
            assert.equal(response.description, '12345678');
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('resource2', 'before', 'post'), true);
            assert.equal(wasInvoked('resource2', 'after', 'post'), true);
            assert.equal(wasInvoked('resource2', 'beforePost', 'post'), true);
            assert.equal(wasInvoked('resource2', 'afterPost', 'post'), true);

            // Store the resource and continue.
            resource = response;
        }));

    it('A GET request should invoke the global handlers', () => request(server)
        .get(`/test/resource2/${resource._id}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1');
            assert.equal(response.description, '12345678');
            assert(response.hasOwnProperty('_id'), 'Resource ID not found');

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('resource2', 'before', 'get'), true);
            assert.equal(wasInvoked('resource2', 'after', 'get'), true);

            // Confirm that POST method handlers were NOT called
            assert.equal(wasInvoked('resource2', 'beforePost', 'get'), false);
            assert.equal(wasInvoked('resource2', 'afterPost', 'get'), false);

            // Store the resource and continue.
            resource = response;
        }));

    it('Should allow you to use select to select certain fields.', () => request(server)
        .get(`/test/resource2/${resource._id}?select=title`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1');
            assert.equal(response.description, undefined);
        }));

    it('A PUT request should invoke the global handlers', () => request(server)
        .put(`/test/resource2/${resource._id}`)
        .send({
            title: 'Test1 - Updated',
        })
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1 - Updated');
            assert.equal(response.description, '12345678');
            assert(response.hasOwnProperty('_id'), 'Resource ID not found');

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('resource2', 'before', 'put'), true);
            assert.equal(wasInvoked('resource2', 'after', 'put'), true);

            // Store the resource and continue.
            resource = response;
        }));

    it('A GET (Index) request should invoke the global handlers', () => request(server)
        .get('/test/resource2')
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'Test1 - Updated');
            assert.equal(response[0].description, '12345678');
            assert(response[0].hasOwnProperty('_id'), 'Resource ID not found');

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('resource2', 'before', 'index'), true);
            assert.equal(wasInvoked('resource2', 'after', 'index'), true);

            // Store the resource and continue.
            resource = response[0];
        }));

    it('A DELETE request should invoke the global handlers', () => request(server)
        .delete(`/test/resource2/${resource._id}`)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.deepEqual(response, {});

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('resource2', 'before', 'delete'), true);
            assert.equal(wasInvoked('resource2', 'after', 'delete'), true);

            // Store the resource and continue.
            resource = response;
        }));
});

describe('Handle native data formats', () => {
    it('Should create a new resource with boolean and string values set.', () => request(server)
        .post('/test/resource2')
        .send({
            title: 'null',
            description: 'false',
            married: true,
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
            assert.equal(response.married, true);
            assert.equal(response.title, 'null');
            assert.equal(response.description, 'false');
        }));

    it('Should find the record when filtering the title as "null"', () => request(server)
        .get('/test/resource2?title=null')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
        }));

    it('Should find the record when filtering the description as "false"', () => request(server)
        .get('/test/resource2?description=false')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].description, 'false');
        }));

    it('Should find the record when filtering the description as "true"', () => request(server)
        .get('/test/resource2?description=true')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 0);
        }));

    it('Should find the record when filtering the updated property as null with strict equality', () => request(server)
        .get('/test/resource2?updated__eq=null')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].updated, null);
        }));

    it('Should still find the null values based on string if explicitely provided "null"', () => request(server)
        .get('/test/resource2?title__eq="null"')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
        }));

    it('Should find the boolean false values based on equality', () => request(server)
        .get('/test/resource2?description__eq=false')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].married, true);
        }));

    it('Should find the boolean true values based on equality', () => request(server)
        .get('/test/resource2?married__eq=true')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].married, true);
        }));

    it('Should still find the boolean values based on string if explicitely provided', () => request(server)
        .get('/test/resource2?description__eq=%22false%22')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].married, true);
        }));

    it('Should still find the boolean values based on string if explicitely provided', () => request(server)
        .get('/test/resource2?married__eq=%22true%22')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].married, true);
        }));

    it('Should CAST a boolean to find the boolean values based on equals', () => request(server)
        .get('/test/resource2?married=true')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, 'null');
            assert.equal(response[0].married, true);
        }));

    it('Should CAST a boolean to find the boolean values based on equals', () => request(server)
        .get('/test/resource2?married=false')
        .send()
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 0);
        }));
});

describe('Test writeOptions capabilities', () => {
    let resource = {};

    it('/POST a new resource3 with options', () => request(server)
        .post('/test/resource3')
        .send({ title: 'Test1' })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1');
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            resource = response;
        }));

    it('/PUT an update with options', () => request(server)
        .put(`/test/resource3/${resource._id}`)
        .send({ title: 'Test1 - Updated' })
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1 - Updated');
            assert(response.hasOwnProperty('_id'), 'Resource ID not found');
        }));

    it('/PATCH an update with options', () => request(server)
        .patch(`/test/resource3/${resource._id}`)
        .send([{ 'op': 'replace', 'path': '/title', 'value': 'Test1 - Updated Again' }])
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1 - Updated Again');
            assert(response.hasOwnProperty('_id'), 'Resource ID not found');
        }));

    it('/DELETE a resource3 with options', () => request(server)
        .delete(`/test/resource3/${resource._id}`)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.deepEqual(response, {});
        }));
});

describe('Test nested resource CRUD capabilities', () => {
    let resource = {};
    let nested = {};

    it('/POST a new parent resource', () => request(server)
        .post('/test/resource1')
        .send({
            title: 'Test1',
            description: '123456789',
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test1');
            assert.equal(response.description, '123456789');
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            resource = response;
        }));

    it('/GET an empty list of nested resources', () => request(server)
        .get(`/test/resource1/${resource._id}/nested1`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '*/0')
        .expect(200)
        .then((res) => {
            assert.equal(res.hasOwnProperty('body'), true);
            assert.deepEqual(res.body, []);
        }));

    it('/POST a new nested resource', () => request(server)
        .post(`/test/resource1/${resource._id}/nested1`)
        .send({
            title: 'Nest1',
            description: '987654321',
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Nest1');
            assert.equal(response.description, '987654321');
            assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource1, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            nested = response;
        }));

    it('/GET the list of nested resources', () => request(server)
        .get(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, nested.title);
            assert.equal(response.description, nested.description);
            assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource1, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response._id, nested._id);
        }));

    it('/PUT the nested resource', () => request(server)
        .put(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .send({
            title: 'Nest1 - Updated1',
        })
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Nest1 - Updated1');
            assert.equal(response.description, nested.description);
            assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource1, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response._id, nested._id);
            nested = response;
        }));

    it('/PATCH data on the nested resource', () => request(server)
        .patch(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .send([{ 'op': 'replace', 'path': '/title', 'value': 'Nest1 - Updated2' }])
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Nest1 - Updated2');
            assert.equal(response.description, nested.description);
            assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource1, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response._id, nested._id);
            nested = response;
        }));

    it('/PATCH rejection on the nested resource due to failed test op', () => request(server)
        .patch(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .send([
            { 'op': 'test', 'path': '/title', 'value': 'not-the-title' },
            { 'op': 'replace', 'path': '/title', 'value': 'Nest1 - Updated3' },
        ])
        .expect('Content-Type', /json/)
        .expect(412)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, nested.title);
            assert.equal(response.description, nested.description);
            assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource1, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response._id, nested._id);
        }));

    it('/GET the nested resource with patch changes', () => request(server)
        .get(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, nested.title);
            assert.equal(response.description, nested.description);
            assert(response.hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource1, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response._id, nested._id);
        }));

    it('/GET index of nested resources', () => request(server)
        .get(`/test/resource1/${resource._id}/nested1`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.length, 1);
            assert.equal(response[0].title, nested.title);
            assert.equal(response[0].description, nested.description);
            assert(response[0].hasOwnProperty('resource1'), 'The response must contain the parent object `_id`');
            assert.equal(response[0].resource1, resource._id);
            assert(response[0].hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response[0]._id, nested._id);
        }));

    it('Cannot /POST to an existing nested resource', () => request(server)
        .post(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .expect('Content-Type', /text\/plain/)
        .expect(404)
        .then((res) => {
            assert.equal(res.text, 'Not Found');
        }));

    it('/DELETE the nested resource', () => request(server)
        .delete(`/test/resource1/${resource._id}/nested1/${nested._id}`)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.deepEqual(response, {});
        }));

    it('/GET an empty list of nested resources', () => request(server)
        .get(`/test/resource1/${resource._id}/nested1/`)
        .expect('Content-Type', /json/)
        .expect('Content-Range', '*/0')
        .expect(200)
        .then((res) => {
            assert.equal(res.hasOwnProperty('body'), true);
            assert.deepEqual(res.body, []);
        }));
});

describe('Test nested resource handlers capabilities', () => {
    // Store the resources being mutated.
    let resource = {};
    let nested = {};

    it('/POST a new parent resource', () => request(server)
        .post('/test/resource2')
        .send({
            title: 'Test2',
            description: '987654321',
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, 'Test2');
            assert.equal(response.description, '987654321');
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            resource = response;
        }));

    it('Reset the history of the global handlers', () => {
        handlers = {};
    });

    it('A POST request to a child resource should invoke the global handlers', () => request(server)
        .post(`/test/resource2/${resource._id}/nested2`)
        .send({
            title: 'Nest2',
            description: '987654321',
        })
        .expect('Content-Type', /json/)
        .expect(201)
        .then((res) => {
            const response = res.body;
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
        }));

    it('A GET request to a child resource should invoke the global handlers', () => request(server)
        .get(`/test/resource2/${resource._id}/nested2/${nested._id}`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.equal(response.title, nested.title);
            assert.equal(response.description, nested.description);
            assert(response.hasOwnProperty('resource2'), 'The response must contain the parent object `_id`');
            assert.equal(response.resource2, resource._id);
            assert(response.hasOwnProperty('_id'), 'The response must contain the mongo object `_id`');
            assert.equal(response._id, nested._id);

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('nested2', 'before', 'get'), true);
            assert.equal(wasInvoked('nested2', 'after', 'get'), true);
        }));

    it('A PUT request to a child resource should invoke the global handlers', () => request(server)
        .put(`/test/resource2/${resource._id}/nested2/${nested._id}`)
        .send({
            title: 'Nest2 - Updated',
        })
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
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
        }));

    it('A GET (Index) request to a child resource should invoke the global handlers', () => request(server)
        .get(`/test/resource2/${resource._id}/nested2`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then((res) => {
            const response = res.body;
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
        }));

    it('A DELETE request to a child resource should invoke the global handlers', () => request(server)
        .delete(`/test/resource2/${resource._id}/nested2/${nested._id}`)
        .expect(200)
        .then((res) => {
            const response = res.body;
            assert.deepEqual(response, {});

            // Confirm that the handlers were called.
            assert.equal(wasInvoked('nested2', 'before', 'delete'), true);
            assert.equal(wasInvoked('nested2', 'after', 'delete'), true);

            // Store the resource and continue.
            resource = response;
        }));
});

describe('Test mount variations', () => {
    before(() => {
        // Create the REST resource and continue.
        Resource(app, '', 'testindex', mongoose.model('testindex', new mongoose.Schema({
            data: {
                type: String,
                required: true,
            },
        }))).index();
    });

    it('/GET empty list', () => request(server)
        .get('/testindex')
        .expect('Content-Type', /json/)
        .expect('Content-Range', '*/0')
        .expect(200)
        .then((res) => {
            assert.equal(res.hasOwnProperty('body'), true);
            assert.deepEqual(res.body, []);
        }));

    it('/POST should be 404', () => request(server)
        .post('/testindex')
        .send({
            title: 'Test1',
            description: '12345678',
        })
        .expect(404));

    it('/GET should be 404', () => request(server)
        .get('/testindex/234234234')
        .expect(404));

    it('/PUT should be 404', () => request(server)
        .put('/testindex/234234234')
        .send({
            title: 'Test2',
        })
        .expect(404));

    it('/PATCH should be 404', () => request(server)
        .patch('/testindex/234234234')
        .send([{ 'op': 'replace', 'path': '/title', 'value': 'Test3' }])
        .expect(404));

    it('/VIRTUAL should be 404', () => request(server)
        .get('/testindex/234234234/virtual')
        .send()
        .expect(404));

    it('/DELETE the resource', () => request(server)
        .delete('/testindex/234234234')
        .expect(404));
});

describe('Test before hooks', () => {
    let calls = [];
    let sub;

    before(() => {
        // Create the schema.
        const hookSchema = new mongoose.Schema({
            data: {
                type: String,
                required: true,
            },
        });

        // Create the model.
        const hookModel = mongoose.model('hook', hookSchema);

        // Create the REST resource and continue.
        Resource(app, '', 'hook', hookModel).rest({
            hooks: {
                post: {
                    async before(ctx, next) {
                        assert.equal(calls.length, 0);
                        calls.push('before');
                        return await next();
                    },
                    async after(ctx, next) {
                        assert.equal(calls.length, 1);
                        assert.deepEqual(calls, ['before']);
                        calls.push('after');
                        return await next();
                    },
                },
                get: {
                    async before(ctx, next) {
                        assert.equal(calls.length, 0);
                        calls.push('before');
                        return await next();
                    },
                    async after(ctx, next) {
                        assert.equal(calls.length, 1);
                        assert.deepEqual(calls, ['before']);
                        calls.push('after');
                        return await next();
                    },
                },
                put: {
                    async before(ctx, next) {
                        assert.equal(calls.length, 0);
                        calls.push('before');
                        return await next();
                    },
                    async after(ctx, next) {
                        assert.equal(calls.length, 1);
                        assert.deepEqual(calls, ['before']);
                        calls.push('after');
                        return await next();
                    },
                },
                delete: {
                    async before(ctx, next) {
                        assert.equal(calls.length, 0);
                        calls.push('before');
                        return await next();
                    },
                    async after(ctx, next) {
                        assert.equal(calls.length, 1);
                        assert.deepEqual(calls, ['before']);
                        calls.push('after');
                        return await next();
                    },
                },
                index: {
                    async before(ctx, next) {
                        assert.equal(calls.length, 0);
                        calls.push('before');
                        return await next();
                    },
                    async after(ctx, next) {
                        assert.equal(calls.length, 1);
                        assert.deepEqual(calls, ['before']);
                        calls.push('after');
                        return await next();
                    },
                },
            },
        });
    });

    describe('post hooks', () => {
        beforeEach(() => {
            calls = [];
        });

        it('Bootstrap some test resources', () => request(server)
            .post('/hook')
            .send({
                data: chance.word(),
            })
            .expect('Content-Type', /json/)
            .expect(201)
            .then((res) => {
                const response = res.body;
                sub = response;
                assert(calls.length === 2);
                assert.equal(calls[0], 'before');
                assert.equal(calls[1], 'after');
            }));

        it('test required validation', () => request(server)
            .post('/hook')
            .send({})
            .expect('Content-Type', /json/)
            .expect(400)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 1);
                assert.equal(calls[0], 'before');
                assert(_.get(response, 'message'), 'hook validation failed');
            }));
    });

    describe('get hooks', () => {
        beforeEach(() => {
            calls = [];
        });

        it('Call hooks are called in order', () => request(server)
            .get(`/hook/${sub._id}`)
            .expect('Content-Type', /json/)
            .expect(200)
            .then(() => {
                assert(calls.length === 2);
                assert.equal(calls[0], 'before');
                assert.equal(calls[1], 'after');
            }));

        it('test undefined resource', () => request(server)
            .get(`/hook/${undefined}`)
            .expect('Content-Type', /json/)
            .expect(400)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 1);
                assert.equal(calls[0], 'before');
                assert.equal(_.get(response, 'message'), 'Cast to ObjectId failed for value "undefined" at path "_id" for model "hook"');
            }));

        it('test unknown resource', () => request(server)
            .get('/hook/000000000000000000000000')
            .expect('Content-Type', /json/)
            .expect(404)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 1);
                assert.equal(calls[0], 'before');
                assert.equal(_.get(response, 'errors[0]'), 'Resource not found');
            }));
    });

    describe('put hooks', () => {
        beforeEach(() => {
            calls = [];
        });

        it('Call hooks are called in order', () => request(server)
            .put(`/hook/${sub._id}`)
            .send({
                data: chance.word(),
            })
            .expect('Content-Type', /json/)
            .expect(200)
            .then(() => {
                assert(calls.length === 2);
                assert.equal(calls[0], 'before');
                assert.equal(calls[1], 'after');
            }));

        it('test undefined resource', () => request(server)
            .put(`/hook/${undefined}`)
            .send({
                data: chance.word(),
            })
            .expect('Content-Type', /json/)
            .expect(400)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 0);
                assert.equal(_.get(response, 'message'), 'Cast to ObjectId failed for value "undefined" at path "_id" for model "hook"');
            }));

        it('test unknown resource', () => request(server)
            .put('/hook/000000000000000000000000')
            .send({
                data: chance.word(),
            })
            .expect('Content-Type', /json/)
            .expect(404)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 0);
                assert.equal(_.get(response, 'errors[0]'), 'Resource not found');
            }));
    });

    describe('delete hooks', () => {
        beforeEach(() => {
            calls = [];
        });

        it('Call hooks are called in order', () => request(server)
            .delete(`/hook/${sub._id}`)
            .expect('Content-Type', /json/)
            .expect(200)
            .then(() => {
                assert(calls.length === 2);
                assert.equal(calls[0], 'before');
                assert.equal(calls[1], 'after');
            }));

        it('test undefined resource', () => request(server)
            .delete(`/hook/${undefined}`)
            .expect('Content-Type', /json/)
            .expect(400)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 0);
                assert.equal(_.get(response, 'message'), 'Cast to ObjectId failed for value "undefined" at path "_id" for model "hook"');
            }));

        it('test unknown resource', () => request(server)
            .delete('/hook/000000000000000000000000')
            .expect('Content-Type', /json/)
            .expect(404)
            .then((res) => {
                const response = res.body;
                assert(calls.length === 0);
                assert.equal(_.get(response, 'errors[0]'), 'Resource not found');
            }));
    });

    describe('index hooks', () => {
        beforeEach(() => {
            calls = [];
        });

        it('Call hooks are called in order', () => request(server)
            .get('/hook')
            .expect('Content-Type', /json/)
            .expect(200)
            .then(() => {
                assert(calls.length === 2);
                assert.equal(calls[0], 'before');
                assert.equal(calls[1], 'after');
            }));
    });
});

describe('Test Swagger.io', () => {

});
