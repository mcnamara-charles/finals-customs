# Finals Customs

A React web application built with Vite.

## Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Environment: copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your Supabase project.

### Supabase (migrations first)

Schema changes live in `supabase/migrations/`. Apply them to your linked project with the [Supabase CLI](https://supabase.com/docs/guides/cli) (for example `supabase db push`), not by running ad-hoc SQL in the dashboard unless you know the two are equivalent. If you do not have the CLI installed globally, use the same commands via `npx supabase` (for example `npx supabase db push`).

`supabase/loadout_states.sql` is reference-only (pointers to the migration that defines the table); the migrations folder is the source of truth.

### Development

Run the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Building for Production

Build the app for production:

```bash
npm run build
```

The built files will be in the `dist` directory.

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

## Project Structure

```
finals-customs/
├── src/
│   ├── App.jsx       # Main application component
│   ├── App.css       # App component styles
│   ├── main.jsx      # Application entry point
│   └── index.css     # Global styles
├── index.html        # HTML template
├── vite.config.js    # Vite configuration
└── package.json      # Project dependencies
```

## Technologies Used

- React 18
- Vite
- Modern JavaScript (ES6+)

