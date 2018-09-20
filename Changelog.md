# Change Log
All notable changes to this project will be documented in this file

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

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
