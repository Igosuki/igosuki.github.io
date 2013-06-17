---
layout: page
title: Gepsens
tagline: To burn always with this hard, gemlike flame, to maintain this ecstasy, is success in life. - Walter Pater
---
{% include JB/setup %}

<ul class="posts">
  {% for post in site.posts %}
    <li><span>{{ post.date | date_to_string }}</span> &raquo; <a href="{{ BASE_PATH }}{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>

