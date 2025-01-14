
let currentSearchType = 'movie'; // Default search type
document.addEventListener("DOMContentLoaded", async () => {
    await fetchAndDisplayPopularMovies();
});

function updateSearchType() {
    const typeSelector = document.getElementById('typeSelector');
    currentSearchType = typeSelector.value;
}

async function searchContent() {
    const movieName = document.getElementById('movieInput').value.trim();
    
    if (!movieName) {
        alert("Please enter a movie or TV show name.");
        return;
    }

    try {
        let id; // Variable to hold the ID (movieId or tvShowId)
         showLoader(); // Show loader while searching
        if (currentSearchType === 'movie') {
            id = await getMovieId(movieName);
            const similarItems = await getSimilarMovies(id);
			const providerPromises = similarItems.map(async (movie) => {
				const providers = await getWatchProviders(movie.id);

				// Extract US-specific data or adjust for another region
				const regionData = providers && providers['FI'];
				const watchLink = regionData ? regionData.link : null;
				const flatrateProviders = regionData ? regionData.flatrate : null;

				return { ...movie, watch: { link: watchLink, flatrate: flatrateProviders } };
			});

			const moviesWithProviders = await Promise.all(providerPromises);

        // Sort the movies by vote_average in descending order
			moviesWithProviders.sort((a, b) => b.vote_average - a.vote_average);
			
            displayResults(moviesWithProviders, true);  // Display as movies
        } else if (currentSearchType === 'tv') {
            id = await getTvShowId(movieName);
            const similarItems = await getSimilarShows(id);
			const providerPromises = similarItems.map(async (movie) => {
				const providers = await getTVWatchProviders(movie.id);

				// Extract US-specific data or adjust for another region
				const regionData = providers && providers['FI'];
				const watchLink = regionData ? regionData.link : null;
				const flatrateProviders = regionData ? regionData.flatrate : null;

				return { ...movie, watch: { link: watchLink, flatrate: flatrateProviders } };
			});

			const moviesWithProviders = await Promise.all(providerPromises);

        // Sort the movies by vote_average in descending order
			moviesWithProviders.sort((a, b) => b.vote_average - a.vote_average);
			
            displayResults(moviesWithProviders, false); // Display as TV shows
        }

        if (!id) {
            alert("Item not found. Please check the spelling and try again.");
        }
    } catch (error) {
        console.error('Error:', error);
        alert("An error occurred. Please try again.");
     } finally {
        hideLoader(); // Hide loader after search completes
    }
}

// Show the loader
function showLoader() {
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
}

// Hide the loader
function hideLoader() {
    const loader = document.getElementById('loader');
    loader.style.display = 'none';
}


async function fetchAndDisplayPopularMovies() {
    const url = `https://api.themoviedb.org/3/discover/movie?language=en-US&sort_by=popularity.desc&page=1`;

	showLoader(); // Show loader while searching
    try {
        const response = await fetch(url);
        const data = await response.json();
        displayPopular(data.results);
    } catch (error) {
        console.error("Error fetching popular movies:", error);
    } finally {
        hideLoader(); // Hide loader after search completes
    }
}


async function getTVWatchProviders(movieId) {

	
	try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${movieId}/watch/providers?api_key=3bbf380371a2169bd25b710058646650`);
        const data = await response.json();
        return data.results; // Return region-specific results
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null on failure
    }
}


async function getWatchProviders(movieId) {

	try {
        const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=3bbf380371a2169bd25b710058646650`);
        const data = await response.json();
        return data.results; // Return region-specific results
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null on failure
    }
}


async function getTvShowId(movieName) {
 
	const url = `https://api.themoviedb.org/3/search/tv?api_key=3bbf380371a2169bd25b710058646650&query=${encodeURIComponent(movieName)}`;

	try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if the search returned any results
        if (data.results.length > 0) {
            const movieId = data.results[0].id;
            //alert(`Movie ID for "${movieName}": ${movieId}`);
            return movieId; // In case you want to use it later
        } else {
            alert("No movies found with that name.");
            return null;
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}

async function getSimilarShows(movieId) {
   
  const url = `https://api.themoviedb.org/3/tv/${movieId}/recommendations?api_key=3bbf380371a2169bd25b710058646650&language=en-US&page=1`;

  try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        return data.results; // This contains the list of similar movies
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}




async function getMovieId(movieName) {

    const url = `https://api.themoviedb.org/3/search/movie?api_key=3bbf380371a2169bd25b710058646650&query=${encodeURIComponent(movieName)}`;

	try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if the search returned any results
        if (data.results.length > 0) {
            const movieId = data.results[0].id;
            //alert(`Movie ID for "${movieName}": ${movieId}`);
            return movieId; // In case you want to use it later
        } else {
            alert("No movies found with that name.");
            return null;
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}

async function getSimilarMovies(movieId) {
   

	const url = `https://api.themoviedb.org/3/movie/${movieId}/recommendations?api_key=3bbf380371a2169bd25b710058646650&language=en-US&page=1`;
    

  try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        return data.results; // This contains the list of similar movies
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}

function displayResults(movies, isMovie) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = ''; // Clear previous results

    movies.forEach(movie => {
        if (!movie.watch || !movie.watch.flatrate) return; // Skip if no provider info

        const movieElement = document.createElement('div');
        movieElement.classList.add('movieItem');

        // Movie Poster (Clickable)
        const imgLink = document.createElement('a');
        imgLink.href = '#'; // Placeholder; search by movie functionality added later
		 if (isMovie) {
            imgLink.onclick = () => {
				document.getElementById('movieInput').value = movie.title; // Set movie title in input
				searchContent(); // Trigger search
			};
        } else {
            imgLink.onclick = () => {
				document.getElementById('movieInput').value = movie.name; // Set movie title in input
				searchContent(); // Trigger search
			};
        }


        const img = new Image();
        img.src = `https://image.tmdb.org/t/p/w200${movie.poster_path}`;
        img.alt = movie.title;
        img.style.cursor = 'pointer'; // Change cursor to indicate clickability
        imgLink.appendChild(img);

        // Movie Details (Title, Release Date, Vote Average)
        const detailsContainer = document.createElement('div');
        detailsContainer.classList.add('movieDetails');

        const title = document.createElement('h2');
        title.textContent = movie.title;

        const releaseDate = document.createElement('p');
		 if (isMovie) {
            releaseDate.textContent = `Release Date: ${movie.release_date}`;
        } else {
			releaseDate.textContent = `First Air Date: ${movie.first_air_date}`;
            
        }
		
        

        const voteAverage = document.createElement('p');
        voteAverage.innerHTML = `Rating: ${movie.vote_average.toFixed(1)} ⭐`;

        detailsContainer.appendChild(title);
        detailsContainer.appendChild(releaseDate);
        detailsContainer.appendChild(voteAverage);

        // Watch Providers
        const providersContainer = document.createElement('div');
        providersContainer.classList.add('providersContainer');

        movie.watch.flatrate.forEach(provider => {
            const providerLink = document.createElement('a');
           // providerLink.href = movie.watch.link || '#'; // Use region-level link
           // providerLink.target = "_blank"; // Open in a new tab

            const providerImg = new Image();
            providerImg.src = provider.logo_path
                ? `https://image.tmdb.org/t/p/original${provider.logo_path}`
                : 'default-provider-logo.png'; // Fallback image
            providerImg.alt = provider.provider_name;
            providerImg.style.width = '50px';

            providerLink.appendChild(providerImg);
            providersContainer.appendChild(providerLink);
        });

        // Append everything
        movieElement.appendChild(imgLink); // Poster on the left
        movieElement.appendChild(detailsContainer); // Details on the right
        detailsContainer.appendChild(providersContainer); // Watch providers below

        container.appendChild(movieElement);
    });
}

function displayPopular(items) {
    const container = document.getElementById("resultsContainer");
    container.innerHTML = ""; // Clear previous results

    items.forEach(item => {
        const { id, title, name, poster_path, release_date, first_air_date, vote_average, genre_ids } = item;
        const type = title ? "movie" : "tv";
        const displayTitle = title || name;
        const displayDate = release_date || first_air_date;

        const movieElement = document.createElement("div");
        movieElement.classList.add("movieItem");

        const imgContainer = document.createElement("a");
        imgContainer.href = "#";
        imgContainer.addEventListener("click", async () => {
            document.getElementById("movieInput").value = displayTitle;
            
            await searchContent();
        });

        const img = new Image();
        img.src = poster_path ? `https://image.tmdb.org/t/p/w200${poster_path}` : "placeholder.jpg";
        img.alt = displayTitle;
        imgContainer.appendChild(img);

        const details = document.createElement("div");
        details.classList.add("movieDetails");

        const titleElement = document.createElement("h2");
        titleElement.textContent = displayTitle;

        const dateElement = document.createElement("p");
        dateElement.textContent = `Release Date: ${displayDate || "Unknown"}`;

        const voteElement = document.createElement("p");
        voteElement.textContent = `Rating: ${vote_average ? vote_average.toFixed(1) : "N/A"} ★`;

        details.appendChild(titleElement);
        details.appendChild(dateElement);
        details.appendChild(voteElement);
        

        movieElement.appendChild(imgContainer);
        movieElement.appendChild(details);
        container.appendChild(movieElement);
    });
}




