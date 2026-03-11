<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/demo-error', function () {
    $user = null;
    return response()->json(['error' => 'User not found'], 404);
});
