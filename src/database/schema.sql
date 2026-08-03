create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  email text unique,
  password_hash text,
  role text check (role in ('host', 'player')) default 'host',
  created_at timestamp default now()
);
create table rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  room_name text,
  host_id uuid references users(id),
  sync_mode text check (sync_mode in ('server', 'optimistic')) default 'server',
  delay_level text check (delay_level in ('low', 'medium', 'high', 'custom')) default 'low',
  delay_ms int default 0,
  status text check (status in ('waiting', 'active', 'finished')) default 'waiting',
  created_at timestamp default now()
);
create table room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  user_id text,
  username text,
  score int default 0,
  joined_at timestamp default now(),
  unique (room_id, username)
);
create table quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by uuid references users(id),
  created_at timestamp default now()
);
alter table rooms
add column quiz_id uuid references quizzes(id) on delete set null;
create table questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade,
  question text not null,
  options jsonb not null,
  correct_answer text not null,
  time_limit int default 15
);
create table game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  current_question_index int default 0,
  started_at timestamp,
  ended_at timestamp,
  status text check (status in ('running', 'ended')) default 'running'
);
create table answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  player_id uuid references room_players(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  question_id uuid references questions(id),
  selected_answer text,
  selected_option text,
  is_correct boolean,
  points_awarded int default 0,
  response_time int,
  created_at timestamp default now(),
  submitted_at timestamp default now(),
  unique (room_id, player_id, question_id)
);
create table leaderboard (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  player_id uuid references room_players(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  score int default 0,
  rank int,
  updated_at timestamp default now(),
  unique (room_id, player_id)
);

create table session_results (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  player_id uuid references room_players(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  score int default 0,
  rank int,
  created_at timestamp default now()
);

create table synchronization_logs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  player_id uuid references room_players(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  question_id uuid references questions(id) on delete set null,
  sync_mode text check (sync_mode in ('server', 'optimistic')),
  event_type text not null default 'answer-submission',
  delay_level text,
  artificial_delay_ms int default 0,
  client_timestamp bigint,
  server_timestamp bigint,
  latency int,
  predicted_score int,
  server_score int,
  reconciliation_required boolean default false,
  score_difference int default 0,
  created_at timestamp default now()
);

create view sync_logs as select * from synchronization_logs;
create view quiz_rooms as select * from rooms;


