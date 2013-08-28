---
layout: post
title: "Chaining jQuery and Angular promises"
date: 2013-06-23 23:54
comments: true
categories: techtalks 
tags: [javascript,jquery,angularjs]
---

Sometimes, you might want to use a library that uses jQuery's deferred to win some time, unfortunately, you might be using another framework such as backbone, lodash, or angular.

In the case of Angular, here is a simple snippet to help you chain jQuery's deferred and Angular's q.

``` javascript Chaining jQuery and Angular's promises
var jQueryDeferred = fooLibrary.fail(function(err) {
    $scope.$apply(function() {
      $scope.errors.push(err.error);
    });
  });
  var deferred = $q.defer();
  fooLibrary.promise().then(function(result) {
    $scope.$apply(function() {
      deferred.resolve(result);
    });
  });
  return deferred.promise.then(function(result) {
    return result;
  });
```

And voila, this should work with most bindings out there.