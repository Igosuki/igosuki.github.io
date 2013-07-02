angular.module('gepsens').service('keyboardEngine', [], function() {
	var stack = [];

	return {
		push: function(e) {
			stack.push(e);
		}
	};
});