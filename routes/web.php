<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Demo error route: triggers NullPointerException for self-healing demo
Route::get('/demo-error', function () {
    $user = null;
    return $user->profile->name; // Intentional: NullPointerException for Nightwatch demo
});
