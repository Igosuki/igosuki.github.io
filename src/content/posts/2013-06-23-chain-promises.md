---
title: Chaining jQuery and Angular promises
description: A small snippet to bridge jQuery's deferred and Angular's $q.
pubDate: 2013-06-23
kind: note
permalink: 2013/06/23/chain-promises
---

Sometimes you want to use a library that relies on jQuery's deferred, but your app uses another framework such as Backbone, lodash or Angular.

For Angular, here is a simple snippet to chain jQuery's deferred and Angular's `$q`.

```javascript
var jQueryDeferred = fooLibrary.fail(function (err) {
  $scope.$apply(function () {
    $scope.errors.push(err.error);
  });
});
var deferred = $q.defer();
fooLibrary.promise().then(function (result) {
  $scope.$apply(function () {
    deferred.resolve(result);
  });
});
return deferred.promise.then(function (result) {
  return result;
});
```

And voilà, this should work with most bindings out there.

*Originally published in 2013. Kept here so old links still work.*
