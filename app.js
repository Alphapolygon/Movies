async function findSimilarMovies() {
    const movieName = document.getElementById('movieInput').value.trim();
    
    if (!movieName) {
        alert("Please enter a movie name.");
        return;
    }
    
    try {
        // Step 1: Get the movie ID using The Movie Database (TMDb) API
        let movieId = await getMovieId(movieName);		
        
        if (!movieId) {
            alert("Movie not found. Please check the spelling and try again.");
            return;
        }
        
        // Step 2: Get similar movies based on the movie ID
        const similarMovies = await getSimilarMovies(movieId);
		
		const providerPromises = similarMovies.map(async (movie) => {
			const providers = await getWatchProviders(movie.id);
			const regionProviders = providers && providers['FI'] ? providers['FI'] : null; // Adjust region as needed
			return { ...movie, watch: regionProviders };
		});

        const moviesWithProviders = await Promise.all(providerPromises);

        // Sort the movies by vote_average in descending order
        moviesWithProviders.sort((a, b) => b.vote_average - a.vote_average);

        // Display the sorted results with provider links
        displayResults(moviesWithProviders);
		
    } catch (error) {
        console.error('Error:', error);
        alert("An error occurred. Please try again.");
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
        return data.results; // Contains region-specific watch provider information
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null to indicate failure
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

function displayResults(movies) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = ''; // Clear previous results

    movies.forEach(movie => {
        if (!movie.watch || !movie.watch.flatrate) return; // Skip if no provider info

        const movieElement = document.createElement('div');
        movieElement.classList.add('movieItem');

        const link = document.createElement('a');
        link.href = `https://www.themoviedb.org/movie/${movie.id}`;
        link.target = "_blank"; // Open in a new tab

        const imgContainer = document.createElement('div');

        const img = new Image();
        img.src = `https://image.tmdb.org/t/p/w200${movie.poster_path}`;
        img.alt = movie.title;
        imgContainer.appendChild(img);

        const providersContainer = document.createElement('div');

        movie.watch.flatrate.forEach(provider => {
            const providerLink = document.createElement('a');
            providerLink.href = provider.link || '#';
            providerLink.target = "_blank";

            const providerImg = new Image();
            providerImg.src = provider.logo_path
                ? `https://image.tmdb.org/t/p/original${provider.logo_path}`
                : 'default-provider-logo.png'; // Replace with your fallback
            providerImg.alt = provider.provider_name;
            providerImg.style.width = '50px';

            providerLink.appendChild(providerImg);
            providersContainer.appendChild(providerLink);
        });

        imgContainer.appendChild(providersContainer);
        link.appendChild(imgContainer);

        const title = document.createElement('h2');
        title.textContent = `${movie.title} (${movie.vote_average.toFixed(1)})`;

        link.appendChild(title);
        movieElement.appendChild(link);

        container.appendChild(movieElement);
    });
}


