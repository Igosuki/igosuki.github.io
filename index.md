---
layout: page
title: 
tagline: 
---
{% include JB/setup %}

<div class="well">
	<h1><small>
	To burn always with this hard, gemlike flame, to maintain this ecstasy, is success in life. 
	</small>
	<small class="highlight">- Walter Pater</small>
	</h1>
</div>

<ul class="posts">
  {% for post in site.posts %}
    <li class="icon-chevron-sign-right"><span>{{ post.date | date_to_string }}</span> <span class="icon-angle-right"></span> <a href="{{ BASE_PATH }}{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>

