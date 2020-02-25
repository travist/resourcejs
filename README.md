Resource.js - A simple Express library to reflect Mongoose models to a REST interface with a splash of Swagger.io love.
==============================================================
[![NPM version][npm-image]][npm-url]
[![NPM download][download-image]][download-url]
[![Build Status](https://travis-ci.org/travist/resourcejs.svg?branch=master)](https://travis-ci.org/travist/resourcejs)
[![Coverage Status](https://coveralls.io/repos/github/Sefriol/resourcejs/badge.svg?branch=master)](https://coveralls.io/github/Sefriol/resourcejs?branch=master)

[npm-image]: https://img.shields.io/npm/v/resourcejs.svg?style=flat-square
[npm-url]: https://npmjs.org/package/resourcejs
[download-image]: https://img.shields.io/npm/dm/resourcejs.svg?style=flat-square
[download-url]: https://npmjs.org/package/resourcejs

Resource.js is designed to be a minimalistic Express library that reflects a Mongoose
model to a RESTful interface. It does this through a very simple and extensible interface.

Installation
--------------
You can install Resource.js using NPM.

```
npm install --save resourcejs
```

Usage
--------------
Provided the following code

```javascript
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var Resource = require('resourcejs');

mongoose.connect('mongodb://localhost/myapp');

// Create the app.
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
  },
  count: {
    type: Number
  }
});

// Create the model.
var ResourceModel = mongoose.model('Resource', ResourceSchema);

// Create the REST resource.
Resource(app, '', 'resource', ResourceModel).rest();
```

The following rest interface would then be exposed.

 * ***/resource*** - (GET) - List all resources.
 * ***/resource*** - (POST) - Create a new resource.
 * ***/resource/:id*** - (GET) - Get a specific resource.
 * ***/resource/:id*** - (PUT) - Replaces an existing resource.
 * ***/resource/:id*** - (PATCH) - Updates an existing resource.
 * ***/resource/:id*** - (DELETE) - Deletes an existing resource.

Parameters
----------------
The ```Resource``` object takes 4 arguments.

```javascript
Resource(app, route, name, model)
```

 - ***app*** - This is the Express application.
 - ***route*** - This is the route to "mount" this resource onto. For example, if you were doing nested resources, this could be '/parent/:parentId'
 - ***name*** - The name of the resource, which will then be used for the URL path of that resource.
 - ***model*** - The Mongoose Model for this interface.

Only exposing certain methods
-------------------
You can also expose only a certain amount of methods, by instead of using
the ***rest*** method, you can use the specific methods and then chain them
together like so.

```javascript
// Do not expose DELETE.
Resource(app, '', 'resource', ResourceModel).get().put().post().index();
```

Adding Before and After handlers
-------------------
This library allows you to handle middleware either before or after the
request is made to the Mongoose query mechanism.  This allows you to
either alter the query being made or, provide authentication.

For example, if you wish to provide basic authentication to every endpoint,
you can use the ***before*** callback attached to the ***rest*** method like so.

```
npm install basic-auth-connect
```

```javascript
var basicAuth = require('basic-auth-connect');

...
...

Resource(app, '', 'resource', ResourceModel).rest({
  before: basicAuth('username', 'password')
});
```

You can also target individual methods so if you wanted to protect POST, PUT, and DELETE
but not GET and INDEX you would do the following.

```javascript
Resource(app, '', 'resource', ResourceModel).rest({
  beforePut: basicAuth('username', 'password'),
  beforePost: basicAuth('username', 'password'),
  beforeDelete: basicAuth('username', 'password')
});
```

You can also do this by specifying the handlers within the specific method calls like so.

```javascript
Resource(app, '', 'resource', ResourceModel)
  .get()
  .put({
    before: basicAuth('username', 'password'),
    after: function(req, res, next) {
      console.log("PUT was just called!");
    }
  })
  .post({
  	before: basicAuth('username', 'password')
  });
```

***After Handlers***:  The after handlers allow you to modify the contents of the resource before it is handed over to the client. It does this by setting a ```resource``` object on the ```res``` object. This ```resource``` object follows the following schema.

  - status: The status code that will be sent to the client.
  - error: Any error that may have been caused within the request.
  - item: The resource item that is going to be sent to the client.

For example, if you have a resource that has a title that is sent to the user, you could change that title by doing the following.

```javascript
Resource(app, '', 'resource', ResourceModel).get({
  after: function(req, res, next) {
    res.resource.item.title = 'I am changing!!';
    next();
  }
});
```

Virtual Resources
-----------------
Virtual resources are not represented by mongodb documents. Instead they are generated by functions acting on existing mongodb documents, typically via the mongodb `aggregate` pipeline.

Resource.js supports this feature by passing `options` to the `resource.virtual` method. The `virtual` method expects at least the `path` and the `before` option params to be set:

* `path`  : Set to the name of the virtual resource. This will be used in the generated url.
* `before`: Set to a function that will be used to generate the virtual resource.

This will result in a generated REST end-point with the following pattern:

* /[resource-name]/virtual/[virtual-resource-name]

For example, defining a virtual resource called `avg-weight` for a resource called `elephant` will give a url of:

* /elephant/virtual/avg-weight

The shape of json data returned is determined by a `before` function. This function will act on an existing document to return a virtual resource of arbitrary shape. Typically a mongodb `aggregate` function will be used here although any valid model query is in fact allowed.

For example, to set up two virtual resources, `max-price` and `max-stock`, for a resource called `product` you would write code similar to the following:

```javascript
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var resource = require('resourcejs');

// Create the app.
var app = express();

// Use the body parser.
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

//Create the Schema
var productSchema = new Schema({
  name: String,
  price: Number,
  stock: Number
});

//Create the model
var productModel = mongoose.model('product', productSchema);

```
You can then define a couple of aggregate functions called `max-price` and `max-stock` using the mongoose model.

```javascript
//Define the virtual resource aggregate functions
var maxPrice = function(req, res, next) {
  req.modelQuery = productModel.aggregate().group({
    _id: null,
    maxPrice: {
      $max: '$price'
    }
  });
  return next();
};

var maxStock = function(req, res, next) {
  req.modelQuery = productModel.aggregate().group({
    _id: null,
    maxStock: {
      $max: '$stock'
    }
  }).select;
  return next();
};
```

You can then setup the `product` via resource.js by passing in the `path` and the `before` function for each virtual resource, like this:

```javascript
//Create the virtual Product resources
resource(app, '', 'product', productModel)
  .virtual({
    path: 'max-price',
    before: maxPrice
  })
  .virtual({
    path: 'max-stock',
    before: maxStock
  });
```

Finally you can retrieve the virtual resources using their generated urls:

#####max-price
* /product/virtual/max-price

returns the `max-price` virtual resource as json:
```javascript
{
  _id:null,
  maxPrice:123
}
```

#####max-stock
* /product/virtual/max-stock

returns the `max-stock` virtual resource as json:
```javascript
{
  _id:null,
  maxStock:321
}
```

Calling the PATCH method
----------------------
ResourceJS fully implements the JSON-Patch spec [RFC-6902](https://tools.ietf.org/html/rfc6902). This allows for partial updates to be made directly to a resource and is therefore a very efficient way of updating a resource.

With JSON-Patch you can also test whether a resource is suitable for a updating and if it is then only update the fields you actually need to update. You can apply an arbitrary sequence of tests and actions (see the spec [RFC-6902](https://tools.ietf.org/html/rfc6902) for more details) and if any one should fail all the changes are rolled back and the resource is left untouched.

For example, using the `Resource` schema above, we will increment just the numeric `count` field but _only if_ the `count` value is the same as the value we are currently holding, in other words - only update the value if nobody else has updated it in the meantime.

This example uses the [request](https://www.npmjs.com/package/request) npm package

```javascript
request = require('request')

function increaseCount(currentCount, resourceId, next) {
  var options, patch;
  patch = [
    {
      "op": "test",
      "path": "/count",
      "value": currentCount
    }, {
      "op": "replace",
      "path": "/count",
      "value": currentCount + 1
    }
  ];
  options = {
    method: 'PATCH',
    uri: "/resource/" + resourceId,
    body: patch,
    json: true
  };
  return request(options, function(err, response, data) {
    return next(data);
  });
}
});
```

Adding custom queries
---------------------------------
Using the method above, it is possible to provide some custom queries in your ***before*** middleware.
We can do this by adding a ***modelQuery*** to the ***req*** object during the middleware. This query
uses the Mongoose query mechanism that you can see here http://mongoosejs.com/docs/api.html#query_Query-where.

For example, if we wish to show an index that filters ages greater than 18, we would do the following.

```javascript
Resource(app, '', 'user', UserModel).rest({
  before: function(req, res, next) {
    req.modelQuery = this.model.where('age').gt(18);
  }
});
```

Passing write options on PUT, POST, PATCH, and DELETE requests
--------------------------------------------------------------
It is possible to pass a set of options to the underlying `Document.save()` and `Document.remove()` commands. This can be useful when plugins expect data to be passed in as options. We can do this by adding a ***writeOptions*** object to the ***req*** object during middleware. This uses the Mongoose mechanism that you can see here https://mongoosejs.com/docs/api.html#document_Document-save.

For example, a set of options can be added by doing the following.

```javascript
Resource(app, '', 'user', UserModel).rest({
  before: function(req, res, next) {
    req.writeOptions = { actingUserId: req.user.id };
  }
});
```

Nested Resources
-----------------
With this library, it is also pretty easy to nest resources. Here is an example of how to do it.

```javascript
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var Resource = require('../Resource');

// Create the app.
var app = express();

// Use the body parser.
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Parent model
var Parent = mongoose.model('Parent', new mongoose.Schema({
  name: {
    type: String,
    required: true
  }
}));

// Child model.
var Child = mongoose.model('Child', new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Parent',
    index: true,
    required: true
  }
}));

// The parent REST interface.
Resource(app, '', 'parent', Parent).rest();

// The child REST interface.
Resource(app, '/parent/:parentId', 'child', Child).rest({

  // Add a before handler to include filter and parent information.
  before: function(req, res, next) {
    req.body.parent = req.params.parentId;
    req.modelQuery = this.model.where('parent', req.params.parentId);
    next();
  }
});
```

This would now expose the following...

 * ***/parent*** - (GET) - List all parents.
 * ***/parent*** - (POST) - Create a new parent.
 * ***/parent/:parentId*** - (GET) - Get a specific parent.
 * ***/parent/:parentId*** - (PUT) - Updates an existing parent.
 * ***/parent/:parentId*** - (DELETE) - Deletes an existing parent.
 * ***/parent/:parentId/child*** - (GET) - List all children of a parent.
 * ***/parent/:parentId/child*** - (POST) - Create a new child.
 * ***/parent/:parentId/child/:childId*** - (GET) - Get a specific child per parent.
 * ***/parent/:parentId/child/:childId*** - (PUT) - Update a child for a parent.
 * ***/parent/:parentId/child/:childId*** - (DELETE) - Delete a child for a parent.

Filtering the results.
--------------------------------
The ```index()``` that is created is capable of doing some complex filtering using Query arguments within the URL. They are described as the following.

| Filter                       | Query    | Example                                              | Description                                                      |
|------------------------------|----------|------------------------------------------------------|------------------------------------------------------------------|
| **equal**                    | `equals` | `/users?gender=male` 			                     | both return all male users                                       |
| **not equal**                | `ne`     | `/users?gender__ne=male`                             | returns all users who are not male (`female` and `x`)            |
| **greater than**             | `gt`     | `/users?age__gt=18`                                  | returns all users older than 18                                  |
| **greater than or equal to** | `gte`    | `/users?age__gte=18`                                 | returns all users 18 and older (age should be a number property) |
| **less than**                | `lt`     | `/users?age__lt=30`                                  | returns all users age 29 and younger                             |
| **less than or equal to**    | `lte`    | `/users?age__lte=30`                                 | returns all users age 30 and younger                             |
| **in**                       | `in`     | `/users?gender__in=female,male`                      | returns all female and male users                                |
| **nin**                      | `nin`    | `/users?age__nin=18,21`                              | returns all users who are not 18 or 21                           |
| **exists=true**              | `exists` | `/users?age__exists=true`                            | returns all users where the age is provided.                     |
| **exists=false**             | `exists` | `/users?age__exists=false`                           | returns all users where the age is not provided.                 |
| **Regex**                    | `regex`  | `/users?username__regex=/^travis/i`                  | returns all users with a username starting with travis           |
| **limit**                    | `limit` | `/users?limit=5`                                     | limits results to the specified amount
| **skip**                     | `skip` | `/users?skip=10`                                     | skip to the specified record in the result set
| **select**                   | `select` | `/users?select=first_name,last_name`               | return only the specified fields

Adding Swagger.io v2 documentation
--------------------------------
Along with auto-generating API's for your application, this library also is able to
auto generate Swagger.io documentation so that your API's are well documented and can
be easily used and understood by everyone.

Each Resource object has the ability to generate the Swagger docs for that resource,
and this can then be combined to create the Swagger docs necessary to feed into the
Swagger UI tools.

***Getting the swagger documentation for a resource***
```javascript
var resource = Resource(app, '', 'resource', ResourceModel).rest();

// Print out the Swagger docs for this resource.
console.log(resource.swagger());
```

You can then use this to create a full specification for you API with all your resources
by doing the following.

```javascript
var _ = require('lodash');

// Define all our resources.
var resources = {
	user: Resource(app, '', 'user', UserModel).rest(),
	group: Resource(app, '', 'group', GroupModel).rest(),
	role: Resource(app, '', 'role', RoleModel).rest()
};

// Get the Swagger paths and definitions for each resource.
var paths = {};
var definitions = {};
_.each(resources, function(resource) {
  var swagger = resource.swagger();
  paths = _.assign(paths, swagger.paths);
  definitions = _.assign(definitions, swagger.definitions);
});

// Define the specification.
var specification = {
  swagger: '2.0',
  info: {
    description: '',
    version: '0.0.1',
    title: '',
    contact: {
      name: 'test@example.com'
    },
    license: {
      name: 'MIT',
      url: 'http://opensource.org/licenses/MIT'
    }
  },
  host: 'localhost:3000',
  basePath: '',
  schemes: ['http'],
  definitions: definitions,
  paths: paths
};

// Show the specification at the URL.
app.get('/spec', function(req, res, next) {
	res.json(specification);
});
```
