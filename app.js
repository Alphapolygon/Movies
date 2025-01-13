let currentSearchType = 'movie'; // Default search type

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
    }
}


async function getTVWatchProviders(movieId) {
	const options = {
	  method: 'GET',
	  headers: {
		accept: 'application/json',
		Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmJmMzgwMzcxYTIxNjliZDI1YjcxMDA1ODY0NjY1MCIsIm5iZiI6MTczNjc3MjgxOC40NCwic3ViIjoiNjc4NTBjZDI5MGY0MmMzMjgzN2I2OTI5Iiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.5FAHYiJQCOUmzlPZdWYsxKQaX7vRpAZE81zgqMX9VmI'
	  }
	};
	
	try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${movieId}/watch/providers`, options);
        const data = await response.json();
        return data.results; // Return region-specific results
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null on failure
    }
}


async function getWatchProviders(movieId) {
	const options = {
	  method: 'GET',
	  headers: {
		accept: 'application/json',
		Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmJmMzgwMzcxYTIxNjliZDI1YjcxMDA1ODY0NjY1MCIsIm5iZiI6MTczNjc3MjgxOC40NCwic3ViIjoiNjc4NTBjZDI5MGY0MmMzMjgzN2I2OTI5Iiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.5FAHYiJQCOUmzlPZdWYsxKQaX7vRpAZE81zgqMX9VmI'
	  }
	};
	
	try {
        const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers`, options);
        const data = await response.json();
        return data.results; // Return region-specific results
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null on failure
    }
}


async function getTvShowId(movieName) {
 
	const options = {
	  method: 'GET',
	  headers: {
		accept: 'application/json',
		Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmJmMzgwMzcxYTIxNjliZDI1YjcxMDA1ODY0NjY1MCIsIm5iZiI6MTczNjc3MjgxOC40NCwic3ViIjoiNjc4NTBjZDI5MGY0MmMzMjgzN2I2OTI5Iiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.5FAHYiJQCOUmzlPZdWYsxKQaX7vRpAZE81zgqMX9VmI'
	  }
	};
    const url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(movieName)}`;

	try {
        const response = await fetch(url, options);
        
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
   
	const options = {
	  method: 'GET',
	  headers: {
		accept: 'application/json',
		Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmJmMzgwMzcxYTIxNjliZDI1YjcxMDA1ODY0NjY1MCIsIm5iZiI6MTczNjc3MjgxOC40NCwic3ViIjoiNjc4NTBjZDI5MGY0MmMzMjgzN2I2OTI5Iiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.5FAHYiJQCOUmzlPZdWYsxKQaX7vRpAZE81zgqMX9VmI'
	  }
	};
	
	
    const url = `https://api.themoviedb.org/3/tv/${movieId}/recommendations?language=en-US&page=1`;

  try {
        const response = await fetch(url,options);
        
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
    const apiKey = 'YOUR_TMDB_API_KEY';
	const options = {
	  method: 'GET',
	  headers: {
		accept: 'application/json',
		Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmJmMzgwMzcxYTIxNjliZDI1YjcxMDA1ODY0NjY1MCIsIm5iZiI6MTczNjc3MjgxOC40NCwic3ViIjoiNjc4NTBjZDI5MGY0MmMzMjgzN2I2OTI5Iiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.5FAHYiJQCOUmzlPZdWYsxKQaX7vRpAZE81zgqMX9VmI'
	  }
	};
    const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(movieName)}`;

	try {
        const response = await fetch(url, options);
        
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
   
	const options = {
	  method: 'GET',
	  headers: {
		accept: 'application/json',
		Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzYmJmMzgwMzcxYTIxNjliZDI1YjcxMDA1ODY0NjY1MCIsIm5iZiI6MTczNjc3MjgxOC40NCwic3ViIjoiNjc4NTBjZDI5MGY0MmMzMjgzN2I2OTI5Iiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9.5FAHYiJQCOUmzlPZdWYsxKQaX7vRpAZE81zgqMX9VmI'
	  }
	};
	
	
    const url = `https://api.themoviedb.org/3/movie/${movieId}/recommendations?language=en-US&page=1`;

  try {
        const response = await fetch(url,options);
        
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
            providerLink.href = movie.watch.link || '#'; // Use region-level link
            providerLink.target = "_blank"; // Open in a new tab

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



