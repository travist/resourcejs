# Change Log
All notable changes to this project will be documented in this file

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## v2.4.0
### Changed
 - Upgrade debug@4.3.2, coveralls@3.1.1, supertest@6.1.6, fast-json-patch@3.1.0, eslint@7.32.0, mongodb@4.1.1, mocha@9.1.0, mongoose@6.0.2

## v2.3.4
### Changed
 - Upgrade dependencies.

## v2.3.3
### Fixed
 - Ensure that filter queries do not override existing filter queries.

## v2.3.2
### Changed
 - Upgrade dependencies.
 - Added support of Range header to index route.

## v2.3.1
### Changed
 - Upgrade mongoose@5.9.22, eslint@7.4.0
 - Revert "High performance optimization during aggregation"

## v2.3.0
### Fixed
 - Issue where a crash could occur with the getQueryParam method.

### Added
 - Support for multiple select query params

### Changed
 - Upgrade dependencies.

## v2.2.0
### Changed
 - Upgrade dependencies.

## v2.1.0
### Added
 - The ability to select certain fields within a single resource using the ?select= query parameter.

### Changed
 - Upgrade mongoose@5.9.6, coveralls@3.0.11

## v2.0.4
### Changed
 - Upgraded mongodb@3.5.5, coveralls@3.0.10, mocha@7.1.1, mongoose@5.9.5

## v2.0.3
### Changed
 - Upgrade dependencies.

## v2.0.2
### Changed
 - Moved the isEmpty method to the utils.

## v2.0.1
### Fixed
 - Problems where _.isEmpty() was replaced with array length checks which does not work to check if objects are empty.
 - The resourcejs middleware paths to be able to be processed outside of Express.

### Changed
 - Upgrade mocha@7.1.0

## v2.0.0
### Changed
 - See https://github.com/travist/resourcejs/pull/109. Many changes.
 - High performance optimization during aggregation
 - Upgrade mongoose@5.9.2 and mongodb@3.5.4

## v1.39.0
### Changed
 - Upgrade mongoose@5.8.11, mongodb@3.5.3, mocha@7.0.1

## v1.38.2
### Fixed
 - Improve swagger schema that includes an array of types

### Changed
 - Upgrade mongodb@3.4.1, mongoose@5.8.3

## v1.38.1
### Fixed
 - Incorrect swagger type getting handled for ObjectId.

## v1.38.0
### Fixed
 - Issue where the ObjectId object is not defined in Swagger.js.

### Changed
 - Upgraded mongodb@3.4.0, mongoose@5.8.0

## v1.37.0
### Changed
 - Upgraded mongodb@3.3.3, chance@1.1.3, mocha@6.2.2, eslint@6.6.0, mongoose@5.7.7

### Added
 - A way to only include model filters in the query.

## v1.32.0
### Changed
 - Improve performance of PUT by not sending stringified version of object to debug.

## v1.31.0
### Changed
 - Now using lean() to improve performance of index and find queries.

## v1.30.0
### Changed
 - If an error occurs in a request middleware, return 400 instead of 500.

## v1.28.0
### Added
 - Add ability to pass options to underlying `.save()` and `.remove()`

### Changed
 - Upgraded mongodb@3.1.8, express@4.16.4, debug@4.1.0, eslint@5.8.0, mongoose@5.3.7

## v1.26.0
### Changed
 - Upgraded fast-json-patch@2.0.7, lodash@4.17.11, mongodb@3.1.6, mongoose@5.2.16, eslint@5.6.0, supertest@3.3.0, debug@4.0.1

## v1.25.4
### Changed
 - Upgrade dependencies.

## v1.25.3
### Changed
 - Upgraded mongodb@3.1.4, mongoose@5.2.10

## v1.25.1
### Changed
 - Upgraded  mongodb@3.1.3, mongoose@5.2.8, eslint@5.3.0

## v1.25.0
### Changed
 - Fixing all deprecation warnings by using countDocuments and using new mongo url parser.

## v1.24.1
### Changed
 - Upgraded mongodb@3.1.1, mongoose@5.2.3, eslint@5.1.0.

### Fixed
 - Date filtering.

## v1.24.0
### Changed
 - Upgraded lodash@4.17.10, moment@2.22.1, mongodb@3.0.8, async@2.6.1, body-parser@1.18.3, chance@1.0.16, mongoose@5.1.3, mocha@5.2.0, supertest@3.1.0

## v1.23.1
### Reverted
 - Ability to filter dates by timestamp. (Conflicts with number filtering)
 - Ability to filter dates by Year. (Conflicts with number filtering)

###  Fixed
 - Filtering by number not working for non root level fields.

## ??
